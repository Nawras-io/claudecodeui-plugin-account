/**
 * HMAC plugin-identity verification.
 *
 * Implements the verification side of the upstream RFC
 * (see ../../docs/internal/upstream-rfc-issue.md). The host signs a small
 * JSON payload with a per-plugin HMAC key derived from JWT_SECRET; the
 * plugin verifies the signature here using its own copy of that key,
 * delivered via the PLUGIN_IDENTITY_KEY env var on spawn.
 *
 * Security properties enforced (intentionally strict to defend against
 * accidental host-side bugs and adversarial proxies):
 *   - 1 KB cap on the base64 payload (rejects oversized inputs early).
 *   - `crypto.timingSafeEqual` on equal-length buffers only; unequal
 *     lengths are rejected without ever calling timingSafeEqual (which
 *     throws on mismatched lengths).
 *   - Replay window: rejects payloads where now - iat > 60 (stale) or
 *     iat - now > 5 (clock-skew / future-dated tokens).
 *   - JSON.parse wrapped in try/catch so a malformed payload returns null
 *     instead of throwing into the request handler.
 *   - Algorithm header pinned to "sha256"; future agility is a new branch,
 *     not a downgrade.
 */
import crypto from 'node:crypto';

export interface PluginUser {
  userId: string | number;
  username: string;
  iat: number;
}

export interface VerifyOptions {
  /** Max age (seconds) of the payload's iat. Default 60. */
  maxAgeSeconds?: number;
  /** Max future skew (seconds) tolerated. Default 5. */
  maxFutureSkewSeconds?: number;
  /** Override "now" for testing. Unix seconds. */
  now?: number;
}

const PAYLOAD_MAX_BASE64_LEN = 1024;

type Headers = Record<string, string | string[] | undefined>;

function pickHeader(headers: Headers, name: string): string | null {
  // Node's http lowercases header names; be defensive for callers that
  // pass an already-extracted record.
  const v = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(v)) return v[0] ?? null;
  return typeof v === 'string' ? v : null;
}

/**
 * Derive the per-plugin HMAC key from JWT_SECRET + plugin name.
 * Mirrors host-side derivation; exported for test / host parity checks.
 * Returns hex string (32 bytes => 64 hex chars).
 */
export function derivePluginIdentityKey(jwtSecret: string, pluginName: string): string {
  return crypto
    .createHmac('sha256', jwtSecret)
    .update(`plugin:${pluginName}`)
    .digest('hex');
}

/**
 * Sign a payload (test / dev helper — production signing happens in the host).
 * Returns the three header values that would arrive on a real request.
 */
export function signPayload(
  payload: { userId: string | number; username: string; iat?: number },
  pluginKeyHex: string,
): { 'x-plugin-user-payload': string; 'x-plugin-user-signature': string; 'x-plugin-user-algorithm': string } {
  const full = {
    userId: payload.userId,
    username: payload.username,
    iat: payload.iat ?? Math.floor(Date.now() / 1000),
  };
  const payloadStr = JSON.stringify(full);
  const sig = crypto
    .createHmac('sha256', Buffer.from(pluginKeyHex, 'hex'))
    .update(payloadStr)
    .digest('hex');
  return {
    'x-plugin-user-payload': Buffer.from(payloadStr, 'utf-8').toString('base64'),
    'x-plugin-user-signature': `sha256=${sig}`,
    'x-plugin-user-algorithm': 'sha256',
  };
}

/**
 * Verify identity headers and return the authenticated user, or null.
 *
 * Returns null (never throws) for any failure mode: missing headers,
 * wrong algorithm, oversized payload, malformed JSON, signature
 * mismatch, stale or future-dated iat. The caller should treat null
 * as "no authenticated user" and respond 401.
 */
export function verifyPluginIdentity(
  headers: Headers,
  pluginKeyHex: string,
  options: VerifyOptions = {},
): PluginUser | null {
  if (!pluginKeyHex || typeof pluginKeyHex !== 'string') return null;

  const payloadB64 = pickHeader(headers, 'x-plugin-user-payload');
  const signatureHeader = pickHeader(headers, 'x-plugin-user-signature');
  const algorithm = pickHeader(headers, 'x-plugin-user-algorithm');

  if (!payloadB64 || !signatureHeader || !algorithm) return null;
  if (algorithm !== 'sha256') return null;

  // Reject oversized payloads early; the legitimate payload is well under 1 KB.
  if (payloadB64.length > PAYLOAD_MAX_BASE64_LEN) return null;

  // Signature header must be of the form "sha256=<hex>".
  const eqIdx = signatureHeader.indexOf('=');
  if (eqIdx <= 0) return null;
  const scheme = signatureHeader.slice(0, eqIdx);
  const sigHex = signatureHeader.slice(eqIdx + 1);
  if (scheme !== 'sha256' || !sigHex) return null;

  // Hex must be even-length valid hex.
  if (sigHex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(sigHex)) return null;

  let pluginKey: Buffer;
  try {
    pluginKey = Buffer.from(pluginKeyHex, 'hex');
    if (pluginKey.length === 0) return null;
  } catch {
    return null;
  }

  let payloadStr: string;
  try {
    payloadStr = Buffer.from(payloadB64, 'base64').toString('utf-8');
  } catch {
    return null;
  }
  // Defensive: if base64 decoding produced an empty string, bail.
  if (!payloadStr) return null;

  const expected = crypto.createHmac('sha256', pluginKey).update(payloadStr).digest();
  let got: Buffer;
  try {
    got = Buffer.from(sigHex, 'hex');
  } catch {
    return null;
  }

  // timingSafeEqual throws if buffers differ in length — guard explicitly.
  if (got.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(got, expected)) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(payloadStr);
  } catch {
    return null;
  }

  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  const userId = p.userId;
  const username = p.username;
  const iat = p.iat;

  if (typeof iat !== 'number' || !Number.isFinite(iat)) return null;
  if (typeof username !== 'string' || username.length === 0) return null;
  if (typeof userId !== 'number' && typeof userId !== 'string') return null;

  const now = options.now ?? Math.floor(Date.now() / 1000);
  const maxAge = options.maxAgeSeconds ?? 60;
  const maxFutureSkew = options.maxFutureSkewSeconds ?? 5;

  if (now - iat > maxAge) return null; // stale
  if (iat - now > maxFutureSkew) return null; // future-dated

  return { userId, username, iat };
}
