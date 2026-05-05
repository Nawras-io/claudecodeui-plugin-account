/**
 * Tests for src/api.ts — focuses on negative paths and the happy path.
 * fetch is fully mocked; no real network is touched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  changePassword,
  changeUsername,
  fetchCurrentUser,
  persistToken,
} from '../api';

const TOKEN_KEY = 'auth-token';

function mockFetchOnce(status: number, body: unknown) {
  const res = {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
  (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(res);
}

beforeEach(() => {
  globalThis.fetch = vi.fn() as unknown as typeof fetch;
  // jsdom-ish localStorage shim
  const store = new Map<string, string>();
  // @ts-expect-error test shim
  globalThis.localStorage = {
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('changePassword', () => {
  it('returns 401 error when no token / unauthorized', async () => {
    mockFetchOnce(401, { error: 'Access token required' });
    const out = await changePassword('old', 'newPass12');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/access token|HTTP 401/i);
  });

  it('surfaces 400 on invalid input (short password)', async () => {
    mockFetchOnce(400, { error: 'New password must be at least 8 characters' });
    const out = await changePassword('old', 'short');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/8 characters/);
  });

  it('returns 429 on rate-limit', async () => {
    mockFetchOnce(429, { error: 'Too many account change attempts. Try again later.' });
    const out = await changePassword('old', 'newPass12');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/too many/i);
  });

  it('happy path: returns refreshed token', async () => {
    persistToken('jwt-old');
    mockFetchOnce(200, { success: true, token: 'jwt-new' });
    const out = await changePassword('old', 'newPass12');
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.data.token).toBe('jwt-new');

    // verifies Authorization header was sent
    const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const init = call[1] as RequestInit;
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer jwt-old');
    expect(init.method).toBe('PUT');
  });

  it('returns NETWORK on fetch failure', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
    const out = await changePassword('old', 'newPass12');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toBe('NETWORK');
  });
});

describe('changeUsername', () => {
  it('returns 400 on invalid username pattern', async () => {
    mockFetchOnce(400, { error: 'Username must be 3–32 characters: letters, numbers, underscore' });
    const out = await changeUsername('pw', 'a!');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/3.{1,3}32/);
  });

  it('returns 409 when username already taken', async () => {
    mockFetchOnce(409, { error: 'Username already taken' });
    const out = await changeUsername('pw', 'taken_name');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toBe('Username already taken');
  });

  it('happy path: returns user + token', async () => {
    mockFetchOnce(200, {
      success: true,
      user: { id: 1, username: 'new_name' },
      token: 'jwt-new',
    });
    const out = await changeUsername('pw', 'new_name');
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data.user.username).toBe('new_name');
      expect(out.data.token).toBe('jwt-new');
    }
  });

  it('falls back to "HTTP <code>" when server returns no JSON error', async () => {
    mockFetchOnce(500, null);
    const out = await changeUsername('pw', 'new_name');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toBe('HTTP 500');
  });
});

describe('fetchCurrentUser', () => {
  it('returns null on 401', async () => {
    mockFetchOnce(401, { error: 'Access token required' });
    expect(await fetchCurrentUser()).toBeNull();
  });

  it('returns user on 200', async () => {
    mockFetchOnce(200, { user: { id: 7, username: 'alice' } });
    const u = await fetchCurrentUser();
    expect(u).toEqual({ id: 7, username: 'alice' });
  });

  it('returns null when fetch throws', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('net'));
    expect(await fetchCurrentUser()).toBeNull();
  });
});

describe('persistToken', () => {
  it('writes to localStorage', () => {
    persistToken('xyz');
    expect(globalThis.localStorage.getItem(TOKEN_KEY)).toBe('xyz');
  });
});
