/**
 * SQLite access for the host's users table.
 *
 * v0.1.x patched the host's repository module directly; v0.2.0 instead
 * opens the same database file (~/.claude-code-ui/auth.db) from inside
 * the plugin process. The schema we depend on:
 *
 *   users(id INTEGER PRIMARY KEY, username TEXT UNIQUE, password_hash TEXT,
 *         is_active INTEGER, ...)
 *
 * We keep the surface tiny and use parameterized statements only.
 *
 * NOTE: better-sqlite3 is loaded via dynamic import so the unit tests
 * (which never touch the DB) don't need it installed. At plugin runtime
 * the host's `npm install` step (during plugin installation) ensures the
 * native module is built; if it's missing we fail loudly with a clear
 * error.
 */
import os from 'node:os';
import path from 'node:path';

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  is_active: number;
}

export interface UserRepository {
  getUserById(id: number | string): UserRow | undefined;
  updatePassword(id: number | string, newHash: string): boolean;
  updateUsername(id: number | string, newUsername: string): boolean;
  close(): void;
}

export function defaultDbPath(): string {
  // Host convention: ~/.claude-code-ui/auth.db
  const home = process.env.HOME || os.homedir();
  return path.join(home, '.claude-code-ui', 'auth.db');
}

let cached: UserRepository | null = null;

export async function openUserRepository(dbPath = defaultDbPath()): Promise<UserRepository> {
  if (cached) return cached;
  // Dynamic require to avoid hard-failing in test envs.
  let Database: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    Database = (await import('better-sqlite3')).default;
  } catch (err) {
    throw new Error(
      `[account-plugin] Failed to load better-sqlite3 — is the plugin installed via the host's installer? (${(err as Error).message})`,
    );
  }

  const db = new Database(dbPath, { fileMustExist: true });
  // Pragmas matching host: WAL keeps readers from blocking writers.
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const getStmt = db.prepare(
    'SELECT id, username, password_hash, is_active FROM users WHERE id = ? AND is_active = 1',
  );
  const updPwdStmt = db.prepare(
    'UPDATE users SET password_hash = ? WHERE id = ? AND is_active = 1',
  );
  const updNameStmt = db.prepare(
    'UPDATE users SET username = ? WHERE id = ? AND is_active = 1',
  );

  cached = {
    getUserById(id) {
      return getStmt.get(id) as UserRow | undefined;
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
    },
  };
  return cached;
}
