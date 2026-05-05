# API Reference

Two endpoints introduced by `server-patch/auth-routes.patch`. Both
require a valid Bearer JWT issued by the host's auth, both demand the
caller's current password as a defense against in-memory token theft,
both refresh the JWT on success, and both are disabled when the host
runs in platform mode (`IS_PLATFORM=true` → `403`).

Rate limit (since v0.1.1): **5 attempts / 15 min per IP + user** on
both endpoints. Exceeding the limit returns `429`.

---

## `PUT /api/auth/account/username`

Change the authenticated user's username.

### Request

```http
PUT /api/auth/account/username
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "currentPassword": "old-password",
  "newUsername":     "new_handle"
}
```

| Field             | Type     | Constraint                       |
| ----------------- | -------- | -------------------------------- |
| `currentPassword` | `string` | required, non-empty              |
| `newUsername`     | `string` | required, `^[a-zA-Z0-9_]{3,32}$` |

### Responses

| Status | Body                                                     | Meaning                                |
| ------ | -------------------------------------------------------- | -------------------------------------- |
| `200`  | `{ "user": {...}, "token": "<new-jwt>" }`                | Updated. Client must replace the JWT.  |
| `400`  | `{ "error": "Invalid username format" }`                 | Pattern violation or missing field.    |
| `401`  | `{ "error": "Invalid credentials" }`                     | Bad token or wrong current password.   |
| `403`  | `{ "error": "Account changes disabled in platform mode" }` | Host is in platform mode.            |
| `409`  | `{ "error": "Username already taken" }`                  | UNIQUE constraint hit.                 |
| `429`  | `{ "error": "Too many attempts. Try again later." }`     | Rate limit.                            |

### Example

```bash
curl -X PUT https://your-host/api/auth/account/username \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"currentPassword":"hunter2","newUsername":"alice_v2"}'
```

---

## `PUT /api/auth/account/password`

Change the authenticated user's password.

### Request

```http
PUT /api/auth/account/password
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "currentPassword": "old-password",
  "newPassword":     "min-eight-chars"
}
```

| Field             | Type     | Constraint                |
| ----------------- | -------- | ------------------------- |
| `currentPassword` | `string` | required, non-empty       |
| `newPassword`     | `string` | required, length ≥ 8      |

### Responses

| Status | Body                                                     | Meaning                                  |
| ------ | -------------------------------------------------------- | ---------------------------------------- |
| `200`  | `{ "user": {...}, "token": "<new-jwt>" }`                | Updated. Client must replace the JWT.    |
| `400`  | `{ "error": "Password too short" }`                      | < 8 chars or missing field.              |
| `401`  | `{ "error": "Invalid credentials" }`                     | Bad token or wrong current password.     |
| `403`  | `{ "error": "Account changes disabled in platform mode" }` | Host is in platform mode.              |
| `429`  | `{ "error": "Too many attempts. Try again later." }`     | Rate limit.                              |

### Example

```bash
curl -X PUT https://your-host/api/auth/account/password \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"currentPassword":"hunter2","newPassword":"correct-horse-battery-staple"}'
```

---

## Notes

- All passwords are stored as bcrypt hashes (cost 12) by the host repository
  (`server-patch/users-repository.patch`).
- After a successful change, the response carries a fresh JWT in the body
  *and* in the `Authorization` response header — clients should replace the
  stored token before issuing further requests.
- These endpoints are designed for **self-hosted, single-tenant** use. In
  multi-tenant or platform deployments the patches keep them disabled.
