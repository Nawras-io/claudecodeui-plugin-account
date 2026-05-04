/**
 * Authenticated fetch helper.
 * Reads the JWT from localStorage (same key as the host app) and attaches it.
 * On a successful auth-change response, persists the refreshed token.
 */

const TOKEN_KEY = 'auth-token';

function token(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function persistToken(t: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, t);
  } catch {
    /* ignore — quota or disabled storage */
  }
}

export type AuthUser = { id: number; username: string };

async function call<T>(url: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  let res: Response;
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const t = token();
    if (t) headers['Authorization'] = `Bearer ${t}`;
    res = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(body) });
  } catch {
    return { ok: false, error: 'NETWORK' };
  }

  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* server returned non-JSON */
  }

  if (!res.ok) {
    return { ok: false, error: (data && data.error) || `HTTP ${res.status}` };
  }
  return { ok: true, data: data as T };
}

export function changePassword(currentPassword: string, newPassword: string) {
  return call<{ success: true; token: string }>('/api/auth/account/password', {
    currentPassword,
    newPassword,
  });
}

export function changeUsername(currentPassword: string, newUsername: string) {
  return call<{ success: true; user: AuthUser; token: string }>('/api/auth/account/username', {
    currentPassword,
    newUsername,
  });
}

/** Reads the current user (no body required). */
export async function fetchCurrentUser(): Promise<AuthUser | null> {
  try {
    const headers: Record<string, string> = {};
    const t = token();
    if (t) headers['Authorization'] = `Bearer ${t}`;
    const res = await fetch('/api/auth/user', { headers });
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.user ? { id: data.user.id, username: data.user.username } : null;
  } catch {
    return null;
  }
}
