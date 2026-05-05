# Server patch

The plug-in calls three endpoints that don't exist in the upstream Claude
Code UI host. Apply these patches once to enable account management.

| Endpoint                         | Method | Purpose                                |
| -------------------------------- | ------ | -------------------------------------- |
| `/api/auth/user`                 | GET    | Current user (already in upstream)     |
| `/api/auth/account/username`     | PUT    | Change username (added by this patch)  |
| `/api/auth/account/password`     | PUT    | Change password (added by this patch)  |

## Files patched

- `server/routes/auth.js` → `auth-routes.patch`
- `server/modules/database/repositories/users.ts` → `users-repository.patch`

## Apply

From the **host repo root** (Claude Code UI):

```bash
git apply path/to/plugins/account/server-patch/auth-routes.patch
git apply path/to/plugins/account/server-patch/users-repository.patch
```

If `git apply` rejects (e.g. upstream evolved), open the patches and copy the
two route handlers + three repository methods manually.

## Peer requirements

The patch imports `express-rate-limit`. The host's `package.json` does **not**
include it by default, so install it once at the host root:

```bash
npm install express-rate-limit@^7
```

`express` and `bcrypt` are already host dependencies.

## What gets added

**Routes** (`server/routes/auth.js`):
- `PUT /api/auth/account/password` — verifies current password, hashes new
  one with bcrypt cost 12, persists, returns a refreshed JWT.
- `PUT /api/auth/account/username` — verifies current password, validates
  `^[a-zA-Z0-9_]{3,32}$`, persists, returns a refreshed JWT.
- Both reject with `403` when `IS_PLATFORM=true`.
- Both gated by an `express-rate-limit` middleware: **5 attempts per
  15 minutes** keyed on `${ip}:${userId}` (returns `429` on excess).

> `rate-limit.patch` is provided as an **incremental** alternative for users
> who already applied an older `auth-routes.patch` without rate-limiting.
> If you apply the current `auth-routes.patch`, do **not** apply
> `rate-limit.patch` — it would conflict.

**Repository** (`server/modules/database/repositories/users.ts`):
- `getUserWithPasswordById(id)` — full row incl. hash (used only for current-
  password verification).
- `updatePassword(id, hash)` — UPDATE on `users.password_hash`.
- `updateUsername(id, name)` — UPDATE on `users.username` (throws on
  UNIQUE conflict; route maps to `409`).

## Security notes

- All endpoints require a valid Bearer token (host's `authenticateToken`).
- Current password is required for both changes (defense against stolen tokens).
- Password hashing: bcrypt cost 12 (matches host convention).
- New token issued on success so the in-flight session keeps working.
- Audit logging is **not** added — wire your own if PDPL/SOX compliance applies.
