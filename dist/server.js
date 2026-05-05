// src/server/server.ts
import http from "node:http";
import { URL } from "node:url";

// src/server/auth.ts
import crypto from "node:crypto";
var PAYLOAD_MAX_BASE64_LEN = 1024;
function pickHeader(headers, name) {
  const v = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(v)) return v[0] ?? null;
  return typeof v === "string" ? v : null;
}
function verifyPluginIdentity(headers, pluginKeyHex, options = {}) {
  if (!pluginKeyHex || typeof pluginKeyHex !== "string") return null;
  const payloadB64 = pickHeader(headers, "x-plugin-user-payload");
  const signatureHeader = pickHeader(headers, "x-plugin-user-signature");
  const algorithm = pickHeader(headers, "x-plugin-user-algorithm");
  if (!payloadB64 || !signatureHeader || !algorithm) return null;
  if (algorithm !== "sha256") return null;
  if (payloadB64.length > PAYLOAD_MAX_BASE64_LEN) return null;
  const eqIdx = signatureHeader.indexOf("=");
  if (eqIdx <= 0) return null;
  const scheme = signatureHeader.slice(0, eqIdx);
  const sigHex = signatureHeader.slice(eqIdx + 1);
  if (scheme !== "sha256" || !sigHex) return null;
  if (sigHex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(sigHex)) return null;
  let pluginKey;
  try {
    pluginKey = Buffer.from(pluginKeyHex, "hex");
    if (pluginKey.length === 0) return null;
  } catch {
    return null;
  }
  let payloadStr;
  try {
    payloadStr = Buffer.from(payloadB64, "base64").toString("utf-8");
  } catch {
    return null;
  }
  if (!payloadStr) return null;
  const expected = crypto.createHmac("sha256", pluginKey).update(payloadStr).digest();
  let got;
  try {
    got = Buffer.from(sigHex, "hex");
  } catch {
    return null;
  }
  if (got.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(got, expected)) return null;
  let payload;
  try {
    payload = JSON.parse(payloadStr);
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") return null;
  const p = payload;
  const userId = p.userId;
  const username = p.username;
  const iat = p.iat;
  if (typeof iat !== "number" || !Number.isFinite(iat)) return null;
  if (typeof username !== "string" || username.length === 0) return null;
  if (typeof userId !== "number" && typeof userId !== "string") return null;
  const now = options.now ?? Math.floor(Date.now() / 1e3);
  const maxAge = options.maxAgeSeconds ?? 60;
  const maxFutureSkew = options.maxFutureSkewSeconds ?? 5;
  if (now - iat > maxAge) return null;
  if (iat - now > maxFutureSkew) return null;
  return { userId, username, iat };
}

// src/server/rateLimit.ts
var RateLimiter = class {
  constructor(opts) {
    this.buckets = /* @__PURE__ */ new Map();
    this.windowMs = opts.windowMs;
    this.max = opts.max;
  }
  /**
   * Returns true if the request is allowed; false if it should be 429'd.
   * Side effect: increments the bucket on allow.
   */
  check(key, now = Date.now()) {
    const b = this.buckets.get(key);
    if (!b || now >= b.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, retryAfterMs: 0 };
    }
    if (b.count >= this.max) {
      return { allowed: false, retryAfterMs: b.resetAt - now };
    }
    b.count += 1;
    return { allowed: true, retryAfterMs: 0 };
  }
  /** Test helper. */
  reset() {
    this.buckets.clear();
  }
};
var accountChangeLimiter = new RateLimiter({ windowMs: 15 * 60 * 1e3, max: 5 });

// src/server/db.ts
import os from "node:os";
import path from "node:path";
function defaultDbPath() {
  const home = process.env.HOME || os.homedir();
  return path.join(home, ".claude-code-ui", "auth.db");
}
var cached = null;
async function openUserRepository(dbPath = defaultDbPath()) {
  if (cached) return cached;
  let Database;
  try {
    Database = (await import("better-sqlite3")).default;
  } catch (err) {
    throw new Error(
      `[account-plugin] Failed to load better-sqlite3 \u2014 is the plugin installed via the host's installer? (${err.message})`
    );
  }
  const db = new Database(dbPath, { fileMustExist: true });
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const getStmt = db.prepare(
    "SELECT id, username, password_hash, is_active FROM users WHERE id = ? AND is_active = 1"
  );
  const updPwdStmt = db.prepare(
    "UPDATE users SET password_hash = ? WHERE id = ? AND is_active = 1"
  );
  const updNameStmt = db.prepare(
    "UPDATE users SET username = ? WHERE id = ? AND is_active = 1"
  );
  cached = {
    getUserById(id) {
      return getStmt.get(id);
    },
    updatePassword(id, newHash) {
      const r = updPwdStmt.run(newHash, id);
      return r.changes > 0;
    },
    updateUsername(id, newUsername) {
      const r = updNameStmt.run(newUsername, id);
      return r.changes > 0;
    },
    close() {
      db.close();
    }
  };
  return cached;
}

// src/server/server.ts
var PLUGIN_NAME = process.env.PLUGIN_NAME || "account";
var PLUGIN_IDENTITY_KEY = process.env.PLUGIN_IDENTITY_KEY || "";
var USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;
var MIN_PASSWORD_LENGTH = 8;
var MAX_BODY_BYTES = 16 * 1024;
if (!PLUGIN_IDENTITY_KEY) {
  console.error(
    `[${PLUGIN_NAME}] PLUGIN_IDENTITY_KEY missing \u2014 host has not implemented the identity RFC yet. All authenticated endpoints will return 401.`
  );
}
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Malformed JSON"));
      }
    });
    req.on("error", reject);
  });
}
function send(res, r) {
  const body = JSON.stringify(r.body ?? {});
  res.writeHead(r.status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}
function authenticate(req) {
  if (!PLUGIN_IDENTITY_KEY) return null;
  return verifyPluginIdentity(req.headers, PLUGIN_IDENTITY_KEY);
}
function rateLimitKey(user, req) {
  const remote = req.socket.remoteAddress || "unknown";
  return `${remote}:${String(user.userId)}`;
}
async function handleMe(_req, user, repo) {
  const id = typeof user.userId === "string" ? Number(user.userId) : user.userId;
  if (!Number.isFinite(id)) {
    return { status: 400, body: { error: "Invalid user id" } };
  }
  const row = repo.getUserById(id);
  if (!row) return { status: 404, body: { error: "User not found" } };
  return { status: 200, body: { user: { id: row.id, username: row.username } } };
}
async function handleChangePassword(req, user, repo) {
  const limit = accountChangeLimiter.check(rateLimitKey(user, req));
  if (!limit.allowed) {
    return { status: 429, body: { error: "Too many account change attempts. Try again later." } };
  }
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return { status: 400, body: { error: err.message } };
  }
  const { currentPassword, newPassword } = body || {};
  if (!currentPassword || !newPassword) {
    return { status: 400, body: { error: "Current and new passwords are required" } };
  }
  if (typeof newPassword !== "string" || newPassword.length < MIN_PASSWORD_LENGTH) {
    return { status: 400, body: { error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters` } };
  }
  if (currentPassword === newPassword) {
    return { status: 400, body: { error: "New password must be different from the current password" } };
  }
  const id = typeof user.userId === "string" ? Number(user.userId) : user.userId;
  const row = repo.getUserById(id);
  if (!row) return { status: 404, body: { error: "User not found" } };
  let bcrypt;
  try {
    bcrypt = (await import("bcrypt")).default ?? await import("bcrypt");
  } catch (err) {
    console.error(`[${PLUGIN_NAME}] bcrypt unavailable:`, err.message);
    return { status: 500, body: { error: "Internal server error" } };
  }
  const valid = await bcrypt.compare(currentPassword, row.password_hash);
  if (!valid) return { status: 401, body: { error: "Current password is incorrect" } };
  const newHash = await bcrypt.hash(newPassword, 12);
  if (!repo.updatePassword(row.id, newHash)) {
    return { status: 500, body: { error: "Failed to update password" } };
  }
  return { status: 200, body: { success: true } };
}
async function handleChangeUsername(req, user, repo) {
  const limit = accountChangeLimiter.check(rateLimitKey(user, req));
  if (!limit.allowed) {
    return { status: 429, body: { error: "Too many account change attempts. Try again later." } };
  }
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return { status: 400, body: { error: err.message } };
  }
  const { currentPassword, newUsername } = body || {};
  if (!currentPassword || !newUsername) {
    return { status: 400, body: { error: "Current password and new username are required" } };
  }
  if (typeof newUsername !== "string" || !USERNAME_RE.test(newUsername)) {
    return { status: 400, body: { error: "Username must be 3\u201332 characters: letters, numbers, underscore" } };
  }
  const id = typeof user.userId === "string" ? Number(user.userId) : user.userId;
  const row = repo.getUserById(id);
  if (!row) return { status: 404, body: { error: "User not found" } };
  if (newUsername === row.username) {
    return { status: 400, body: { error: "New username must be different from the current one" } };
  }
  let bcrypt;
  try {
    bcrypt = (await import("bcrypt")).default ?? await import("bcrypt");
  } catch (err) {
    console.error(`[${PLUGIN_NAME}] bcrypt unavailable:`, err.message);
    return { status: 500, body: { error: "Internal server error" } };
  }
  const valid = await bcrypt.compare(currentPassword, row.password_hash);
  if (!valid) return { status: 401, body: { error: "Current password is incorrect" } };
  try {
    if (!repo.updateUsername(row.id, newUsername)) {
      return { status: 500, body: { error: "Failed to update username" } };
    }
  } catch (err) {
    if (err && err.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return { status: 409, body: { error: "Username already taken" } };
    }
    throw err;
  }
  return { status: 200, body: { success: true, user: { id: row.id, username: newUsername } } };
}
async function handleSessions(_req, _user) {
  return { status: 200, body: { sessions: [] } };
}
async function dispatch(req, res, repo) {
  try {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const method = (req.method || "GET").toUpperCase();
    if (method === "GET" && url.pathname === "/health") {
      return send(res, { status: 200, body: { status: "ok" } });
    }
    const user = authenticate(req);
    if (!user) return send(res, { status: 401, body: { error: "User identity not available" } });
    if (method === "GET" && url.pathname === "/me") {
      return send(res, await handleMe(req, user, repo));
    }
    if (method === "POST" && url.pathname === "/change-password") {
      return send(res, await handleChangePassword(req, user, repo));
    }
    if (method === "POST" && url.pathname === "/change-username") {
      return send(res, await handleChangeUsername(req, user, repo));
    }
    if (method === "GET" && url.pathname === "/sessions") {
      return send(res, await handleSessions(req, user));
    }
    send(res, { status: 404, body: { error: "Not found" } });
  } catch (err) {
    console.error(`[${PLUGIN_NAME}]`, err);
    send(res, { status: 500, body: { error: "Internal server error" } });
  }
}
async function main() {
  let repo = null;
  try {
    repo = await openUserRepository();
  } catch (err) {
    console.error(`[${PLUGIN_NAME}] DB open failed:`, err.message);
  }
  const server = http.createServer((req, res) => {
    if (!repo) {
      return send(res, { status: 503, body: { error: "Database unavailable" } });
    }
    void dispatch(req, res, repo);
  });
  server.listen(0, "127.0.0.1", () => {
    const addr = server.address();
    if (addr && typeof addr !== "string") {
      console.log(JSON.stringify({ ready: true, port: addr.port }));
    }
  });
  const shutdown = (signal) => {
    console.error(`[${PLUGIN_NAME}] received ${signal}, shutting down`);
    server.close(() => {
      try {
        repo?.close();
      } catch {
      }
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 4500).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
var isEntrypoint = (() => {
  try {
    const url = import.meta?.url;
    if (url && process.argv[1]) {
      return url === new URL(`file://${process.argv[1]}`).href;
    }
  } catch {
  }
  return false;
})();
if (isEntrypoint) {
  void main();
}
export {
  dispatch
};
