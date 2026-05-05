<!--
Target repo: siteboon/claudecodeui (upstream)
Target form: GitHub Issue (Feature Request / RFC)
Filed by: Nawras-io maintainers (contact via GitHub: @Nawras-io)
Date drafted: 2026-05-05
Status: DRAFT — awaiting human review before posting
-->

# RFC: Forward authenticated user identity to plugin servers (HMAC-signed headers)

## Summary

The current plugin subprocess architecture authenticates the user at the host layer but drops `req.user` before proxying to the plugin's HTTP/WebSocket server, leaving plugin backends with zero knowledge of who issued the request. This RFC proposes a small, backwards-compatible addition: the host derives a per-plugin HMAC key from `JWT_SECRET`, provisions it to the plugin via an env var on spawn, and attaches three signed headers (`X-Plugin-User-Payload`, `X-Plugin-User-Signature`, `X-Plugin-User-Algorithm`) to every proxied HTTP request and WebSocket upgrade. Plugins that opt in can verify identity statelessly without ever seeing `JWT_SECRET`. Plugins that ignore the headers continue to work unchanged.

Filed by Nawras-io, the open-source initiative of Al-Kindi.

This issue is filed against `siteboon/claudecodeui` as the upstream of record. The same change is needed in the downstream fork `@cloudcli-ai/cloudcli` (which our reference implementation targets); we are happy to coordinate parallel PRs so both stay in sync.

## Motivation

We are building [`Nawras-io/claudecodeui-plugin-account`](https://github.com/Nawras-io), a plugin that lets the logged-in user manage their own account (change password, view active sessions, update profile) entirely through the plugin surface — no host patches, no UI shims. The plugin discovers a hard wall:

- The host validates the JWT in `server/middleware/auth.js` (`authenticateToken`, lines 19-68) and populates `req.user` with the authenticated user (exposing `userId` and `username`; `id` may be present as an alias).
- The plugin RPC route `ALL /api/plugins/:name/rpc/*` in `server/routes/plugins.js` (lines 207-283) re-emits the request to `127.0.0.1:<plugin-port>` but forwards only method, path, query, `Content-Type`, body, and the per-plugin `X-Plugin-Secret-*` headers. `req.user` and the `Authorization` header are intentionally not forwarded.
- The plugin process is spawned in `server/utils/plugin-process-manager.js` (`startPluginServer`, lines 15-105) with a deliberately minimal env (`PATH`, `HOME`, `NODE_ENV`, `PLUGIN_NAME`). `JWT_SECRET` is correctly withheld.
- The WebSocket proxy in `server/modules/websocket/services/plugin-websocket-proxy.service.ts` (`handlePluginWsProxy`, lines 5-65) authenticates the client at upgrade but opens the upstream socket to the plugin without forwarding any identity material.

The net effect: a plugin that wants to act on behalf of "the current user" cannot. For an account-management plugin this is a hard blocker for the use case. The plugin would have to either (a) replicate JWT verification (which requires sharing `JWT_SECRET`, defeating the isolation model) or (b) trust an unauthenticated `userId` in the request body (easily spoofed by a non-malicious user inspecting browser dev tools).

We believe a small, well-scoped primitive in the host solves this cleanly for the account plugin and for an entire category of future plugins (audit log, notifications, personal settings, per-user telemetry).

## Current behavior

```
Client (browser)
   |
   | POST /api/plugins/account/rpc/change-password
   | Authorization: Bearer <JWT>
   v
Host: authenticateToken            (auth.js:19-68)
   | req.user = { id, userId, username }   <-- identity exists here
   v
Host: plugin RPC handler           (routes/plugins.js:207-283)
   | builds proxy request with method/path/body/X-Plugin-Secret-*
   | req.user is NOT attached       <-- identity dropped here
   v
Plugin server (127.0.0.1:<port>)
   | receives request with no auth context
   | cannot identify the caller
```

The same drop occurs at the WebSocket boundary in `plugin-websocket-proxy.service.ts`.

## Proposed design

### Headers

The host attaches three headers to every proxied HTTP request and WebSocket upgrade when `req.user` is populated:

| Header | Value |
| --- | --- |
| `X-Plugin-User-Payload` | base64(UTF-8 JSON of the identity payload) |
| `X-Plugin-User-Signature` | `sha256=<hex digest>` |
| `X-Plugin-User-Algorithm` | `sha256` (reserved for future agility) |

Payload schema:

```ts
interface PluginUserPayload {
  userId: string | number;  // from req.user.userId (canonical; host may fall back to req.user.id alias)
  username: string;         // from req.user.username
  iat: number;              // Unix seconds, set by host at sign time
}
```

### Plugin-scoped key derivation

The host never shares `JWT_SECRET`. It derives a per-plugin key:

```
pluginKey = HMAC-SHA256(JWT_SECRET, "plugin:" + pluginName)
```

This key is:

- deterministic — the host can recompute it on every request without storage;
- isolated — leaking one plugin's key reveals nothing about `JWT_SECRET` or other plugins' keys;
- bound to plugin name — renaming a plugin rotates its key automatically.

### Provisioning to the plugin

At spawn time the host adds one env var:

```
PLUGIN_IDENTITY_KEY=<hex of pluginKey>
```

The plugin reads it once at startup. No host-plugin handshake, no key exchange protocol, no shared filesystem state.

### Replay protection

The payload includes `iat`. The plugin rejects payloads where `now - iat > 60` seconds. This is sufficient for a localhost transport with no caching layer; the window can be tightened or made configurable based on maintainer preference.

### Identical treatment for HTTP and WebSocket

Headers are added in `routes/plugins.js` for HTTP and in `plugin-websocket-proxy.service.ts` on the upstream `WebSocket` constructor's `headers` option for WS upgrades. Plugins use the same verification helper for both.

## Code sketches

### Host-side: signing in the HTTP proxy

`server/routes/plugins.js`, inside the `/:name/rpc/*` handler, after the existing header build:

> **The host MUST construct the proxied header set from scratch and MUST strip any inbound `X-Plugin-User-*` headers from the original client request before adding its own signed headers.** This prevents header injection from a malicious or naive client.

```js
import crypto from 'node:crypto';

if (req.user) {
  const payloadStr = JSON.stringify({
    userId: req.user.userId ?? req.user.id,
    username: req.user.username,
    iat: Math.floor(Date.now() / 1000),
  });

  const pluginKey = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`plugin:${pluginName}`)
    .digest();

  const signature = crypto
    .createHmac('sha256', pluginKey)
    .update(payloadStr)
    .digest('hex');

  headers['x-plugin-user-payload']   = Buffer.from(payloadStr).toString('base64');
  headers['x-plugin-user-signature'] = `sha256=${signature}`;
  headers['x-plugin-user-algorithm'] = 'sha256';
}
```

### Host-side: provisioning the key on spawn

`server/utils/plugin-process-manager.js`, in `startPluginServer`:

```js
const pluginKey = crypto
  .createHmac('sha256', jwtSecret)
  .update(`plugin:${name}`)
  .digest('hex');

const pluginProcess = spawn('node', [serverPath], {
  cwd: pluginDir,
  env: {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_ENV: process.env.NODE_ENV || 'production',
    PLUGIN_NAME: name,
    PLUGIN_IDENTITY_KEY: pluginKey,   // new
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
```

The signature requires `startPluginServer` to receive `jwtSecret`. This should be straightforward to thread from the host bootstrap (the secret already exists in the auth module scope) and would be passed in alongside the existing call site in `startEnabledPluginServers()`.

### Host-side: WebSocket upgrade

`server/modules/websocket/services/plugin-websocket-proxy.service.ts`, when opening the upstream socket:

```ts
const upstream = new WebSocket(`ws://127.0.0.1:${port}/ws`, [], {
  headers: identityHeaders,   // same three headers, computed as above
});
```

`identityHeaders` is built once per upgrade from `req.user` (already validated by `verifyWebSocketClient`).

Plugin-side: when using the `ws` library's `WebSocketServer`, upgrade headers are exposed via the second argument (`request: IncomingMessage`) of the `connection` event handler.

### Plugin-side verification helper

A plugin pulls in roughly twenty lines:

```ts
import crypto from 'node:crypto';

export function verifyPluginIdentity(headers, pluginKeyHex) {
  const payloadB64 = headers['x-plugin-user-payload'];
  const sigHeader  = headers['x-plugin-user-signature'];
  const algo       = headers['x-plugin-user-algorithm'];
  if (!payloadB64 || !sigHeader || algo !== 'sha256') return null;

  const [scheme, sigHex] = String(sigHeader).split('=');
  if (scheme !== 'sha256' || !sigHex) return null;

  // Cap payload size to bound parse cost (~768 bytes after base64 decode).
  if (String(payloadB64).length > 1024) return null;

  const payloadStr = Buffer.from(payloadB64, 'base64').toString('utf-8');
  const expected = crypto
    .createHmac('sha256', Buffer.from(pluginKeyHex, 'hex'))
    .update(payloadStr)
    .digest();
  const got = Buffer.from(sigHex, 'hex');
  if (got.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(got, expected)) return null;

  let payload;
  try {
    payload = JSON.parse(payloadStr);
  } catch {
    return null;
  }
  if (typeof payload.iat === 'number') {
    const now = Math.floor(Date.now() / 1000);
    // Reject stale payloads and far-future timestamps (clock-skew bound).
    if (now - payload.iat > 60) return null;
    if (payload.iat - now > 5) return null;
  }
  return { userId: payload.userId, username: payload.username };
}
```

## Backwards compatibility

This change is strictly additive at the wire level:

- Plugins that do not read `PLUGIN_IDENTITY_KEY` and do not inspect the new headers behave identically to today. The headers are unknown to them and ignored by Node's HTTP parser.
- The manifest schema is unchanged. No new required fields. No migration of `plugins.json`.
- Existing per-plugin `X-Plugin-Secret-*` headers are untouched.
- Disabled plugins, plugins without a `server` entry, and plugins running in platform mode are unaffected.

A plugin opts in simply by reading `process.env.PLUGIN_IDENTITY_KEY` and verifying the headers on requests it cares about.

## Non-goals

- Authorization (what a user can do) — the host stays the source of truth.
- TLS on localhost between host and plugin process.
- Plugin → host API authentication (separate concern).
- Permission-scope enforcement (left for a future RFC; see Open Questions).

## Security considerations

- **Constant-time comparison.** Verification must use `crypto.timingSafeEqual` on equal-length buffers. The helper above enforces both.
- **Replay window.** A 60-second `iat` window is the proposed default. Localhost transport plus the short window makes replay effectively a no-op; the value can be tightened to 5-10 seconds with no UX cost.
- **Plugin compromise blast radius.** A compromised plugin leaks only its own `PLUGIN_IDENTITY_KEY`. That key cannot forge identity for any other plugin and cannot be used to mint JWTs. `JWT_SECRET` itself never leaves the host process.
- **Out of scope: localhost transport security.** Plugin servers bind `127.0.0.1`. This RFC does not change that posture and does not introduce TLS-on-loopback. We assume the host's existing threat model (a non-root local attacker on the same machine is already game over) continues to apply.
- **Out of scope: plugin write access to user records.** Identity verification proves *who* is asking; it does not authorize *what* they can do. Plugins that need to mutate user records (e.g. `change-password`) still call host APIs that own the database. The host remains the sole writer to `userDb`. This RFC deliberately does not introduce a plugin-side DB handle.
- **Logging hygiene.** The signed payload is small and contains only `userId`, `username`, `iat`. We recommend documenting that plugins should not log the raw payload or signature.

## Alternatives considered

- **Forward the raw JWT (or `JWT_SECRET`) to the plugin.** Rejected: breaks the existing isolation invariant in `plugin-process-manager.js`, makes secret rotation a multi-process restart, and turns every plugin into a JWT-minting oracle if compromised.
- **Per-request short-lived bearer token issued by the host.** Rejected on complexity grounds: requires a token store or a second JWT signing path, plus revocation semantics. HMAC headers achieve the same guarantees with no state.
- **Session cookies forwarded to the plugin.** Rejected: not stateless, couples plugin to session storage, and conflicts with the WebSocket path.
- **Manifest-declared "trusted" plugins that receive `JWT_SECRET`.** Rejected: a trust tier above "isolated subprocess" is a much larger design discussion and is not needed for the account-management use case.

## Open questions for maintainers

We have opinions on each of these but want to defer to the project's conventions:

1. **Header naming.** Do you prefer `X-Plugin-*` (transport-neutral, matches the existing `X-Plugin-Secret-*` convention) or a vendor-prefixed `X-Cloudcli-*` / `X-Claudecodeui-*`? We are also fine with a single combined header.
2. **`iat` window.** Should the 60-second replay window be a constant, an env var (`PLUGIN_IDENTITY_MAX_AGE_SECONDS`), or per-plugin in `plugins.json`?
3. **Manifest opt-in.** Should plugins declare `"needsUserIdentity": true` (or a `"capabilities": ["user-identity"]` array) in `manifest.json` so the host only signs for plugins that ask, and the UI can surface this at install time?
4. **WebSocket transport choice.** Upgrade-time headers are the simplest path, but some WS clients strip custom headers behind proxies. Would you prefer an in-band first-message protocol (host sends a signed `{type:"identity", ...}` frame immediately after upstream connect) instead of, or in addition to, upgrade headers?
5. **Plugin SDK.** Would you accept a small first-party module (e.g. `@siteboon/claudecodeui-plugin-sdk` or `@cloudcli-ai/plugin-sdk`) exporting `verifyPluginIdentity` so plugins do not reimplement constant-time HMAC checks? We can contribute the initial cut.
6. **`plugins.json` schema migration.** If we add an opt-in field, do you want a versioned schema with a one-time migrator, or is "absent = legacy default" sufficient?
7. **`permissions` enforcement.** The `permissions` field in the manifest is currently parsed but unenforced. This RFC proposes activating that field with a concrete enforcement model (e.g. `user:read` gates whether identity headers are signed at all). Would the maintainer team prefer to address that here, or to treat permission enforcement as a separate RFC and keep this one minimal?

## Implementation plan

Files to modify:

- `server/utils/plugin-process-manager.js` — derive `PLUGIN_IDENTITY_KEY`, pass into spawn env, accept `jwtSecret` parameter.
- `server/utils/plugin-process-manager.js` — `startEnabledPluginServers()` thread `jwtSecret` from bootstrap.
- `server/routes/plugins.js` — sign identity headers in the `/:name/rpc/*` proxy.
- `server/modules/websocket/services/plugin-websocket-proxy.service.ts` — sign identity headers on upstream WS upgrade.
- `server/index.js` — pass `jwtSecret` into the plugin-process-manager call site (single line).
- Documentation: a `docs/plugins/identity.md` describing the headers, env var, and the recommended verification snippet.

No changes required in `server/utils/plugin-loader.js`, the manifest validator, or `plugins.json` (unless an opt-in field is adopted per Open Question 3).

## Test plan

Unit tests:

- **Signature roundtrip.** Sign a payload with key derived from a known `JWT_SECRET` and plugin name; verify with the plugin-side helper. Asserts byte-for-byte stability of the derivation.
- **Tampered payload.** Mutate one byte of the base64 payload; verification returns `null`.
- **Tampered signature.** Mutate the hex digest; verification returns `null`.
- **Wrong algorithm.** Set `X-Plugin-User-Algorithm: sha512`; verification returns `null` (forward-compat: future algorithms add a branch, not a downgrade).
- **Missing headers.** Each of the three headers absent in turn; verification returns `null`.
- **Replay window.** `iat` set to 120 seconds in the past; verification returns `null`. `iat` set to 30 seconds in the past; verification succeeds.
- **Constant-time check.** Statistical timing test (best-effort) confirms equal-length comparison.

Integration tests:

- HTTP RPC: authenticated user hits `/api/plugins/<name>/rpc/whoami`, plugin echoes the verified `userId`. Asserts identity matches `req.user.id`.
- HTTP RPC unauthenticated: plugin receives no headers, helper returns `null`, handler returns 401.
- WebSocket: client connects with valid JWT, plugin's first received message includes verified identity.
- Plugin restart: kill and respawn the plugin process; verify the new process receives a `PLUGIN_IDENTITY_KEY` byte-identical to the previous one (deterministic derivation).
- Key rotation: change `JWT_SECRET`, restart host; existing plugin processes are restarted by the manager and the new key flows through; old signatures fail.
- Two plugins side-by-side: confirm `pluginKey(A) != pluginKey(B)` and a header signed for A fails verification when delivered to B.

Manual / acceptance:

- Install `Nawras-io/claudecodeui-plugin-account` against a host with this RFC applied; change-password flow completes end-to-end without any host-side patches.

## Reference implementation

We have an in-progress experimental branch of the account plugin that exercises this design end-to-end against a locally patched host:

- `Nawras-io/claudecodeui-plugin-account` — `v0.2.0` line of work, currently on a feature branch. The plugin's backend reads `PLUGIN_IDENTITY_KEY` and verifies the three headers with the helper shown above. Status: **in progress**, pending this RFC's resolution before we tag.

A complete internal technical analysis of the host's plugin pipeline (with file:line citations matching this RFC) is available and we're glad to share it on request — it documents the exact code paths that need to change and was the basis for the sketches above.

## Closing

We are prepared to send a PR with the host-side changes (process manager, HTTP proxy, WS proxy, docs, tests) once the design questions above are resolved to your satisfaction. We have no attachment to the specifics of the header names, the opt-in mechanism, or the SDK packaging — the only things we feel strongly about are (a) `JWT_SECRET` must not leave the host, and (b) HTTP and WebSocket paths should expose identity through the same primitive. Everything else is yours to shape.

Thanks for maintaining this project. The plugin architecture is already in great shape; this is a small addition that unlocks a meaningful class of plugins.
