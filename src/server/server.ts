/**
 * EXPERIMENTAL — depends on upstream RFC (see docs/internal/upstream-rfc-issue.md).
 * Will not function correctly until siteboon/claudecodeui implements the
 * PLUGIN_IDENTITY_KEY env var + identity headers on the proxy.
 *
 * Pure-plugin v0.2.0 backend entry. Spawned as a Node subprocess by the
 * host's plugin-process-manager. Speaks plain HTTP on a 127.0.0.1
 * ephemeral port and prints `{ ready: true, port: <n> }` to stdout when
 * the listener is up.
 *
 * Endpoints (mounted under /api/plugins/account/rpc/* by the host):
 *   GET  /me                — current user profile (id, username)
 *   POST /change-password   — change own password (rate-limited)
 *   POST /change-username   — change own username (rate-limited)
 *   GET  /sessions          — placeholder; host owns session storage
 *   GET  /health            — liveness probe (no auth)
 */
import http from 'node:http';
import { URL } from 'node:url';

import { verifyPluginIdentity, type PluginUser } from './auth.js';
import { accountChangeLimiter } from './rateLimit.js';
import { openUserRepository, type UserRepository } from './db.js';

const PLUGIN_NAME = process.env.PLUGIN_NAME || 'account';
const PLUGIN_IDENTITY_KEY = process.env.PLUGIN_IDENTITY_KEY || '';
const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;
const MIN_PASSWORD_LENGTH = 8;
const MAX_BODY_BYTES = 16 * 1024;

if (!PLUGIN_IDENTITY_KEY) {
  // Don't hard-exit: log loudly and serve 401 on every request. This
  // way an old host (pre-RFC) still sees the plugin's ready signal and
  // the failure mode is observable from the UI rather than a crash loop.
  // eslint-disable-next-line no-console
  console.error(
    `[${PLUGIN_NAME}] PLUGIN_IDENTITY_KEY missing — host has not implemented the identity RFC yet. All authenticated endpoints will return 401.`,
  );
}

interface JsonResponse {
  status: number;
  body: unknown;
}

function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Malformed JSON'));
      }
    });
    req.on('error', reject);
  });
}

function send(res: http.ServerResponse, r: JsonResponse): void {
  const body = JSON.stringify(r.body ?? {});
  res.writeHead(r.status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function authenticate(req: http.IncomingMessage): PluginUser | null {
  if (!PLUGIN_IDENTITY_KEY) return null;
  return verifyPluginIdentity(req.headers as Record<string, string | string[] | undefined>, PLUGIN_IDENTITY_KEY);
}

function rateLimitKey(user: PluginUser, req: http.IncomingMessage): string {
  // Mirror v0.1.x policy: keyed by user id with remote address fallback.
  const remote = req.socket.remoteAddress || 'unknown';
  return `${remote}:${String(user.userId)}`;
}

async function handleMe(_req: http.IncomingMessage, user: PluginUser, repo: UserRepository): Promise<JsonResponse> {
  const id = typeof user.userId === 'string' ? Number(user.userId) : user.userId;
  if (!Number.isFinite(id as number)) {
    return { status: 400, body: { error: 'Invalid user id' } };
  }
  const row = repo.getUserById(id as number);
  if (!row) return { status: 404, body: { error: 'User not found' } };
  return { status: 200, body: { user: { id: row.id, username: row.username } } };
}

async function handleChangePassword(
  req: http.IncomingMessage,
  user: PluginUser,
  repo: UserRepository,
): Promise<JsonResponse> {
  const limit = accountChangeLimiter.check(rateLimitKey(user, req));
  if (!limit.allowed) {
    return { status: 429, body: { error: 'Too many account change attempts. Try again later.' } };
  }

  let body: any;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return { status: 400, body: { error: (err as Error).message } };
  }

  const { currentPassword, newPassword } = body || {};
  if (!currentPassword || !newPassword) {
    return { status: 400, body: { error: 'Current and new passwords are required' } };
  }
  if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
    return { status: 400, body: { error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters` } };
  }
  if (currentPassword === newPassword) {
    return { status: 400, body: { error: 'New password must be different from the current password' } };
  }

  const id = typeof user.userId === 'string' ? Number(user.userId) : user.userId;
  const row = repo.getUserById(id as number);
  if (!row) return { status: 404, body: { error: 'User not found' } };

  // bcrypt loaded dynamically — same reasoning as better-sqlite3 in db.ts.
  let bcrypt: any;
  try {
    bcrypt = (await import('bcrypt')).default ?? (await import('bcrypt'));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[${PLUGIN_NAME}] bcrypt unavailable:`, (err as Error).message);
    return { status: 500, body: { error: 'Internal server error' } };
  }

  const valid = await bcrypt.compare(currentPassword, row.password_hash);
  if (!valid) return { status: 401, body: { error: 'Current password is incorrect' } };

  const newHash = await bcrypt.hash(newPassword, 12);
  if (!repo.updatePassword(row.id, newHash)) {
    return { status: 500, body: { error: 'Failed to update password' } };
  }
  return { status: 200, body: { success: true } };
}

async function handleChangeUsername(
  req: http.IncomingMessage,
  user: PluginUser,
  repo: UserRepository,
): Promise<JsonResponse> {
  const limit = accountChangeLimiter.check(rateLimitKey(user, req));
  if (!limit.allowed) {
    return { status: 429, body: { error: 'Too many account change attempts. Try again later.' } };
  }

  let body: any;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return { status: 400, body: { error: (err as Error).message } };
  }
  const { currentPassword, newUsername } = body || {};
  if (!currentPassword || !newUsername) {
    return { status: 400, body: { error: 'Current password and new username are required' } };
  }
  if (typeof newUsername !== 'string' || !USERNAME_RE.test(newUsername)) {
    return { status: 400, body: { error: 'Username must be 3–32 characters: letters, numbers, underscore' } };
  }

  const id = typeof user.userId === 'string' ? Number(user.userId) : user.userId;
  const row = repo.getUserById(id as number);
  if (!row) return { status: 404, body: { error: 'User not found' } };
  if (newUsername === row.username) {
    return { status: 400, body: { error: 'New username must be different from the current one' } };
  }

  let bcrypt: any;
  try {
    bcrypt = (await import('bcrypt')).default ?? (await import('bcrypt'));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[${PLUGIN_NAME}] bcrypt unavailable:`, (err as Error).message);
    return { status: 500, body: { error: 'Internal server error' } };
  }

  const valid = await bcrypt.compare(currentPassword, row.password_hash);
  if (!valid) return { status: 401, body: { error: 'Current password is incorrect' } };

  try {
    if (!repo.updateUsername(row.id, newUsername)) {
      return { status: 500, body: { error: 'Failed to update username' } };
    }
  } catch (err: any) {
    if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return { status: 409, body: { error: 'Username already taken' } };
    }
    throw err;
  }
  return { status: 200, body: { success: true, user: { id: row.id, username: newUsername } } };
}

async function handleSessions(_req: http.IncomingMessage, _user: PluginUser): Promise<JsonResponse> {
  // Placeholder: session storage lives in the host. Until the host
  // exposes a session-listing API to plugins, return an empty list.
  return { status: 200, body: { sessions: [] } };
}

export async function dispatch(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  repo: UserRepository,
): Promise<void> {
  try {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const method = (req.method || 'GET').toUpperCase();

    if (method === 'GET' && url.pathname === '/health') {
      return send(res, { status: 200, body: { status: 'ok' } });
    }

    const user = authenticate(req);
    if (!user) return send(res, { status: 401, body: { error: 'User identity not available' } });

    if (method === 'GET' && url.pathname === '/me') {
      return send(res, await handleMe(req, user, repo));
    }
    if (method === 'POST' && url.pathname === '/change-password') {
      return send(res, await handleChangePassword(req, user, repo));
    }
    if (method === 'POST' && url.pathname === '/change-username') {
      return send(res, await handleChangeUsername(req, user, repo));
    }
    if (method === 'GET' && url.pathname === '/sessions') {
      return send(res, await handleSessions(req, user));
    }

    send(res, { status: 404, body: { error: 'Not found' } });
  } catch (err) {
    // Generic outward message; structured detail to stderr only.
    // eslint-disable-next-line no-console
    console.error(`[${PLUGIN_NAME}]`, err);
    send(res, { status: 500, body: { error: 'Internal server error' } });
  }
}

async function main(): Promise<void> {
  let repo: UserRepository | null = null;
  try {
    repo = await openUserRepository();
  } catch (err) {
    // Don't refuse to start — surface via /health and 500s on protected routes.
    // eslint-disable-next-line no-console
    console.error(`[${PLUGIN_NAME}] DB open failed:`, (err as Error).message);
  }

  const server = http.createServer((req, res) => {
    if (!repo) {
      return send(res, { status: 503, body: { error: 'Database unavailable' } });
    }
    void dispatch(req, res, repo);
  });

  server.listen(0, '127.0.0.1', () => {
    const addr = server.address();
    if (addr && typeof addr !== 'string') {
      // Required readiness handshake for plugin-process-manager.
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ ready: true, port: addr.port }));
    }
  });

  const shutdown = (signal: string) => {
    // eslint-disable-next-line no-console
    console.error(`[${PLUGIN_NAME}] received ${signal}, shutting down`);
    server.close(() => {
      try {
        repo?.close();
      } catch {
        /* ignore */
      }
      process.exit(0);
    });
    // Hard limit; the host will SIGKILL us at 5s anyway.
    setTimeout(() => process.exit(0), 4500).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Only run when invoked as the entrypoint (not when imported by tests).
const isEntrypoint = (() => {
  try {
    // import.meta.url is set in ESM; fall back to argv check.
    // @ts-ignore
    const url = import.meta?.url;
    if (url && process.argv[1]) {
      return url === new URL(`file://${process.argv[1]}`).href;
    }
  } catch {
    /* ignore */
  }
  return false;
})();

if (isEntrypoint) {
  void main();
}
