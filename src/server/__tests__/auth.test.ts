/**
 * Unit tests for the HMAC plugin-identity verifier.
 * Pure Node — no DB, no http.
 */
import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';

import {
  derivePluginIdentityKey,
  signPayload,
  verifyPluginIdentity,
} from '../auth';

const JWT_SECRET = 'test-jwt-secret-do-not-use-in-prod';
const PLUGIN_NAME = 'account';
const KEY = derivePluginIdentityKey(JWT_SECRET, PLUGIN_NAME);

function freshHeaders(overrides: Partial<{ userId: number | string; username: string; iat: number }> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return signPayload(
    {
      userId: overrides.userId ?? 1,
      username: overrides.username ?? 'alice',
      iat: overrides.iat ?? now,
    },
    KEY,
  );
}

describe('verifyPluginIdentity', () => {
  it('accepts a fresh, well-formed signature (roundtrip)', () => {
    const headers = freshHeaders();
    const user = verifyPluginIdentity(headers, KEY);
    expect(user).not.toBeNull();
    expect(user?.username).toBe('alice');
    expect(user?.userId).toBe(1);
  });

  it('rejects a tampered payload', () => {
    const headers = freshHeaders();
    // flip a byte in the base64 payload
    const tampered = headers['x-plugin-user-payload'];
    const mutated =
      tampered.slice(0, 5) + (tampered[5] === 'A' ? 'B' : 'A') + tampered.slice(6);
    const out = verifyPluginIdentity({ ...headers, 'x-plugin-user-payload': mutated }, KEY);
    expect(out).toBeNull();
  });

  it('rejects a tampered signature', () => {
    const headers = freshHeaders();
    const sig = headers['x-plugin-user-signature']; // sha256=<hex>
    const [scheme, hex] = sig.split('=');
    const flipped = hex.slice(0, -1) + (hex.endsWith('a') ? 'b' : 'a');
    const out = verifyPluginIdentity(
      { ...headers, 'x-plugin-user-signature': `${scheme}=${flipped}` },
      KEY,
    );
    expect(out).toBeNull();
  });

  it('returns null when any header is missing', () => {
    const headers = freshHeaders();
    expect(verifyPluginIdentity({ ...headers, 'x-plugin-user-payload': undefined }, KEY)).toBeNull();
    expect(verifyPluginIdentity({ ...headers, 'x-plugin-user-signature': undefined }, KEY)).toBeNull();
    expect(verifyPluginIdentity({ ...headers, 'x-plugin-user-algorithm': undefined }, KEY)).toBeNull();
    expect(verifyPluginIdentity({}, KEY)).toBeNull();
  });

  it('rejects unsupported algorithms (forward-compat: never silently downgrade)', () => {
    const headers = freshHeaders();
    expect(verifyPluginIdentity({ ...headers, 'x-plugin-user-algorithm': 'sha512' }, KEY)).toBeNull();
    expect(verifyPluginIdentity({ ...headers, 'x-plugin-user-algorithm': 'md5' }, KEY)).toBeNull();
  });

  it('rejects stale payloads (now - iat > 60)', () => {
    const now = 1_700_000_000;
    const headers = signPayload({ userId: 1, username: 'alice', iat: now - 61 }, KEY);
    const out = verifyPluginIdentity(headers, KEY, { now });
    expect(out).toBeNull();
  });

  it('accepts payloads at the boundary (exactly 60s old)', () => {
    const now = 1_700_000_000;
    const headers = signPayload({ userId: 1, username: 'alice', iat: now - 60 }, KEY);
    expect(verifyPluginIdentity(headers, KEY, { now })).not.toBeNull();
  });

  it('rejects future-dated payloads (iat - now > 5)', () => {
    const now = 1_700_000_000;
    const headers = signPayload({ userId: 1, username: 'alice', iat: now + 6 }, KEY);
    expect(verifyPluginIdentity(headers, KEY, { now })).toBeNull();
  });

  it('accepts tiny clock skew (iat - now <= 5)', () => {
    const now = 1_700_000_000;
    const headers = signPayload({ userId: 1, username: 'alice', iat: now + 5 }, KEY);
    expect(verifyPluginIdentity(headers, KEY, { now })).not.toBeNull();
  });

  it('rejects oversized base64 payloads (>1024 chars)', () => {
    const headers = freshHeaders();
    const oversized = 'A'.repeat(1025);
    const out = verifyPluginIdentity({ ...headers, 'x-plugin-user-payload': oversized }, KEY);
    expect(out).toBeNull();
  });

  it('returns null (does not throw) on malformed JSON inside a valid signature', () => {
    // Forge a payload whose body is not valid JSON, but sign it with the
    // real key so the signature check passes — verifier must still bail.
    const garbage = 'this is not json {';
    const sig = crypto
      .createHmac('sha256', Buffer.from(KEY, 'hex'))
      .update(garbage)
      .digest('hex');
    const headers = {
      'x-plugin-user-payload': Buffer.from(garbage, 'utf-8').toString('base64'),
      'x-plugin-user-signature': `sha256=${sig}`,
      'x-plugin-user-algorithm': 'sha256',
    };
    expect(() => verifyPluginIdentity(headers, KEY)).not.toThrow();
    expect(verifyPluginIdentity(headers, KEY)).toBeNull();
  });

  it('rejects equal-length-but-wrong signatures (constant-time path)', () => {
    const headers = freshHeaders();
    const sig = headers['x-plugin-user-signature'];
    const hex = sig.split('=')[1];
    // Replace with same-length all-zero hex — equal length, wrong content.
    const fake = '0'.repeat(hex.length);
    const out = verifyPluginIdentity(
      { ...headers, 'x-plugin-user-signature': `sha256=${fake}` },
      KEY,
    );
    expect(out).toBeNull();
  });

  it('rejects unequal-length signatures without throwing', () => {
    const headers = freshHeaders();
    const short = 'sha256=deadbeef'; // 8 hex chars instead of 64
    expect(() =>
      verifyPluginIdentity({ ...headers, 'x-plugin-user-signature': short }, KEY),
    ).not.toThrow();
    expect(
      verifyPluginIdentity({ ...headers, 'x-plugin-user-signature': short }, KEY),
    ).toBeNull();
  });

  it('rejects malformed signature header (no scheme separator)', () => {
    const headers = freshHeaders();
    expect(
      verifyPluginIdentity({ ...headers, 'x-plugin-user-signature': 'no-equals-sign' }, KEY),
    ).toBeNull();
  });

  it('rejects empty/invalid plugin key', () => {
    const headers = freshHeaders();
    expect(verifyPluginIdentity(headers, '')).toBeNull();
    expect(verifyPluginIdentity(headers, 'not-hex-zz')).toBeNull();
  });

  it('rejects payloads that pass signature but lack required fields', () => {
    const partial = JSON.stringify({ userId: 1 }); // missing username, iat
    const sig = crypto
      .createHmac('sha256', Buffer.from(KEY, 'hex'))
      .update(partial)
      .digest('hex');
    const headers = {
      'x-plugin-user-payload': Buffer.from(partial, 'utf-8').toString('base64'),
      'x-plugin-user-signature': `sha256=${sig}`,
      'x-plugin-user-algorithm': 'sha256',
    };
    expect(verifyPluginIdentity(headers, KEY)).toBeNull();
  });

  it('per-plugin key isolation: plugin A signature does not verify under plugin B key', () => {
    const keyA = derivePluginIdentityKey(JWT_SECRET, 'plugin-a');
    const keyB = derivePluginIdentityKey(JWT_SECRET, 'plugin-b');
    expect(keyA).not.toBe(keyB);
    const headers = signPayload({ userId: 1, username: 'alice' }, keyA);
    expect(verifyPluginIdentity(headers, keyA)).not.toBeNull();
    expect(verifyPluginIdentity(headers, keyB)).toBeNull();
  });
});
