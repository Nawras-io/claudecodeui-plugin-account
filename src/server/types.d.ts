// Minimal ambient declarations for runtime-only deps.
// We don't pull in @types/bcrypt to keep the dev surface lean; the
// plugin only calls compare/hash and treats results as opaque.
declare module 'bcrypt' {
  export function compare(plain: string, hash: string): Promise<boolean>;
  export function hash(plain: string, rounds: number): Promise<string>;
  const _default: { compare: typeof compare; hash: typeof hash };
  export default _default;
}

declare module 'better-sqlite3' {
  const Database: any;
  export default Database;
}
