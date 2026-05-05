# CloudCLI Plugin System Technical Analysis

**Date:** 2026-05-05  
**Analysis Version:** 1.0  
**Target Host:** @cloudcli-ai/cloudcli v1.31.5 (dist-server)  
**Objective:** Design "claudecodeui-plugin-account" v0.2.0 as a pure plugin with full user identity support

---

## Executive Summary

The cloudcli plugin system is a **pure subprocess architecture** where plugins run as independent Node.js processes with HTTP/WebSocket communication to the host. The architecture is intentionally minimal and well-separated:

- **Plugin discovery:** Manifests at `~/.claude-code-ui/plugins/*/manifest.json`
- **Plugin execution:** Spawned as isolated Node.js children with minimal env (PATH, HOME, NODE_ENV, PLUGIN_NAME)
- **Plugin communication:** HTTP localhost proxying at `/api/plugins/:name/rpc/*` + WebSocket at `/plugin-ws/:name`
- **Current limitation:** User identity (JWT claims) is **dropped at the host's auth middleware** before reaching the plugin layer; plugins have **no way to identify which user made a request**

The RFC design calls for HMAC-signed identity headers forwarded to plugin servers, allowing plugins to authenticate the logged-in user without replication of the host's JWT secret.

---

## 1. Plugin Loader Architecture

**File:** `/usr/lib/node_modules/@cloudcli-ai/cloudcli/server/utils/plugin-loader.js`

### 1.1 Plugin Discovery

- Plugins are user-local directories in `~/.claude-code-ui/plugins/`
- Each plugin is a sibling directory (e.g., `account/`, `project-stats/`, `enhanced-appearance/`)
- Config persisted to `~/.claude-code-ui/plugins.json` (mode 0o600, readable/writable by owner only)

### 1.2 Manifest Schema

**Required fields:**
- `name` (string, alphanumeric + hyphen/underscore only) — used in routes, must be URL-safe
- `displayName` (string) — shown in UI
- `entry` (relative path, no `..` traversal) — frontend UI entry point

**Allowed types:** `['react', 'module']`
**Allowed slots:** `['tab']`

**Optional fields:**

| Field | Type | Description | Default |
|-------|------|-------------|---------|
| `version` | string | Plugin version | `'0.0.0'` |
| `description` | string | Plugin description | `''` |
| `author` | string | Author name | `''` |
| `icon` | string | Icon name or path | `'Puzzle'` |
| `type` | `'react'` \| `'module'` | UI type | `'module'` |
| `slot` | `'tab'` | UI placement | `'tab'` |
| `server` | relative path | **Backend server entry point** | `null` |
| `permissions` | string[] | Requested permissions/scopes | `[]` |

**Key observation:** `server` field is **optional** and points to a Node.js entry file that will be spawned as a subprocess. If omitted, only frontend UI is loaded (no backend).


### 1.3 Plugin Scanning

The scanPlugins() function (lines 127-201):
- Reads all directories in PLUGINS_DIR
- For each directory, reads manifest.json and validates
- Tries to read .git/config for repoUrl (sanitizes embedded credentials)
- Returns PluginInfo object with enabled state from config

**Returned structure:**
```javascript
{
  name,                       // from manifest
  displayName,
  version,
  description,
  author,
  icon,
  type,
  slot,
  entry,
  server,                     // null or relative path
  permissions,
  enabled,                    // from config[name].enabled (defaults true)
  dirName,                    // filesystem directory name
  repoUrl,                    // git remote URL (sanitized)
}
```

### 1.4 Plugin Installation

**Git-based installation (lines 225-329):**

1. Clone to temp dir: `.tmp-{repoName}-*` (prevents scanPlugins seeing partial installs)
2. npm install --ignore-scripts (no postinstall hooks = no arbitrary code)
3. npm run build (if scripts.build exists)
4. Validate manifest exists and passes validation
5. Atomic rename into place (temp -> plugins/repoName)

---

## 2. Plugin Process Manager

**File:** `/usr/lib/node_modules/@cloudcli-ai/cloudcli/server/utils/plugin-process-manager.js`

### 2.1 Server Startup Protocol

**Function:** `startPluginServer(name, pluginDir, serverEntry)` (lines 15-105)

**Environment isolation:**
```javascript
const pluginProcess = spawn('node', [serverPath], {
  cwd: pluginDir,
  env: {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_ENV: process.env.NODE_ENV || 'production',
    PLUGIN_NAME: name,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
```

- Only `PATH`, `HOME`, `NODE_ENV`, `PLUGIN_NAME` passed
- **NO** host JWT_SECRET, API keys, or other sensitive vars
- `cwd` is the plugin directory (allows relative requires)

**Readiness protocol (lines 52-76):**

Plugin subprocess **must print a JSON line to stdout** within 10 seconds:
```json
{ "ready": true, "port": <number> }
```

Example from starter plugin:
```javascript
const addr = server.address();
if (addr && typeof addr !== 'string') {
  console.log(JSON.stringify({ ready: true, port: addr.port }));
}
```

If no ready message or process exits before timeout: startup fails.

### 2.2 Process Lifecycle

**Eager startup on host boot (lines 167-183):**
- Called from host server boot via `startEnabledPluginServers()`
- For each plugin with manifest.server && enabled: start server
- Errors logged but don't abort host startup

**Lazy startup on first request (routes/plugins.js:186-201):**
- If no port and plugin has server entry: start server on demand
- Second request waits for first promise (concurrency coalescing via startingPlugins map)

**On-demand toggling (routes/plugins.js:100-137):**
- PUT /api/plugins/:name/enable { enabled: boolean }
- If enabled=true and has server: startPluginServer()
- If enabled=false: stopPluginServer()

**Graceful shutdown (lines 111-136):**
```javascript
// Send SIGTERM to plugin process
// Wait 5 seconds for graceful shutdown
// Force SIGKILL if still running after 5s
```

### 2.3 State Tracking

```javascript
const runningPlugins = new Map();   // Map<name, { process, port }>
const startingPlugins = new Map();  // Map<name, Promise<port>> (coalescing)
```

---

## 3. Plugin HTTP/WebSocket Proxy Layer

**File:** `/usr/lib/node_modules/@cloudcli-ai/cloudcli/server/routes/plugins.js`

### 3.1 RPC HTTP Proxy

**Route:** `ALL /api/plugins/:name/rpc/*` (lines 207-283)

**Current implementation flow:**

1. Client → Host: `POST /api/plugins/account/rpc/change-password` with JWT auth
2. **Authentication middleware (`authenticateToken`)** runs at app level (index.js:132)
   - Validates JWT using JWT_SECRET
   - Populates `req.user` with `{ id, userId, username }`
3. Plugin route handler receives `req` **BUT `req.user` IS NOT FORWARDED** to plugin server

**What is forwarded to plugin server:**
- ✅ Request method (GET, POST, etc.)
- ✅ Request path (/change-password)
- ✅ Query string
- ✅ Content-Type header
- ✅ Request body (re-stringified)
- ✅ Per-plugin secrets (X-Plugin-Secret-* headers)
- ❌ **User identity** (req.user is NOT sent)
- ❌ **JWT token** (Authorization header is NOT forwarded)
- ❌ **Any standard HTTP auth headers**

**CRITICAL GAP:** Plugin server has **zero knowledge** of which user made the request.

### 3.2 WebSocket Proxy

**File:** `/usr/lib/node_modules/@cloudcli-ai/cloudcli/server/modules/websocket/services/plugin-websocket-proxy.service.ts` (lines 5-65)

**Route:** `/plugin-ws/:name` (websocket-server.service.ts:48-50)

- Client WS connects to host at `/plugin-ws/account`
- Host verifies authentication (user in `req.user` from verifyWebSocketClient)
- Host opens new WS to `ws://127.0.0.1:{port}/ws`
- Messages relayed bidirectionally
- ❌ **User identity NOT passed to plugin** (no auth headers, no custom headers)

---

## 4. Authentication Context & User Identity

**File:** `/usr/lib/node_modules/@cloudcli-ai/cloudcli/server/middleware/auth.js`

### 4.1 Request Authentication (HTTP)

**Middleware:** `authenticateToken()` (lines 19-68)

**JWT validation:**
- Extract JWT from Authorization header (Bearer TOKEN) or query param `?token=`
- Decode JWT using JWT_SECRET
- Verify user exists in userDb
- Auto-refresh token if past halfway through lifetime
- Populate `req.user = { id, userId, username }`

**Platform mode:** Skip JWT validation, use single DB user

**After authentication, `req.user` contains:**
```javascript
{
  id,        // User ID (int or string)
  userId,    // Alias for id
  username,  // Username
}
```

### 4.2 WebSocket Authentication

**Function:** `authenticateWebSocket(token)` (lines 77-109)

- Same JWT validation as HTTP
- Returns `{ id, userId, username }` or null
- Used by verifyWebSocketClient() (websocket-auth.service.ts:45)

### 4.3 JWT Secret Management

```javascript
const JWT_SECRET = process.env.JWT_SECRET || appConfigDb.getOrCreateJwtSecret();
```

- If `JWT_SECRET` env var set, use it
- Otherwise, generate unique secret per installation and persist in app config DB
- **Available only to host process** (not passed to plugins)

---

## 5. Plugin Permissions & Capability Model

**Current state:** Minimal; permissions field exists but unused.

Manifest can declare `permissions: ["scope1", "scope2"]` but:
- Host **does not enforce** any permission checks currently
- No scoping mechanism in place
- Plugin can request any string; host ignores

**Implications:**
- Permissions field is a **placeholder for future enforcement**
- Currently, all plugins are trusted equally
- No UI for granting/denying plugin permissions

---

## 6. Example Plugin: cloudcli-plugin-starter

**Location:** `~/.claude-code-ui/plugins/cloudcli-plugin-starter/`

**Manifest:**
```json
{
  "name": "project-stats",
  "displayName": "Project Stats",
  "version": "1.0.0",
  "description": "A starter plugin that shows project stats...",
  "type": "module",
  "slot": "tab",
  "entry": "dist/index.js",
  "server": "dist/server.js",
  "permissions": []
}
```

**Backend server (dist/server.js, lines 97-120):**
- Starts HTTP server on localhost, port 0 (OS assigns)
- Prints `{ ready: true, port: <number> }` to stdout
- Listens only to 127.0.0.1 requests (secure, host can proxy)
- Endpoint: `GET /stats?path=/some/path` returns project statistics
- **Key observation:** No authentication (assumes proxy layer handles it) — BUT PROXY DOESN'T!

---

## 7. Current Authentication Gap Analysis

### 7.1 The Problem

**Scenario:** User "alice" makes request to `POST /api/plugins/account/rpc/change-password`

1. **Host receives and authenticates request**
   - Validates JWT, populates `req.user = { id: 1, username: "alice" }`

2. **Host proxies to plugin (plugins.js:207)**
   ```
   POST http://127.0.0.1:9876/change-password HTTP/1.1
   Content-Type: application/json
   { "newPassword": "..." }
   ```
   - **User identity is NOT in the request**

3. **Plugin server receives request**
   - `req.user` is undefined (Express doesn't auto-populate)
   - **Plugin cannot identify the user**
   - Catastrophic for account management: plugin could change ANY user's password!

### 7.2 Why JWT_SECRET Can't Be Shared

- **Secret exposure risk:** If plugin secret is leaked, attacker can forge tokens
- **Privilege boundary:** Plugin is untrusted code; host is privileged
- **Update complexity:** Can't rotate JWT_SECRET without restarting all plugins

### 7.3 Proposed Solution: HMAC-Signed Headers (RFC Design)

**Goal:** Forward user identity to plugin WITHOUT sharing JWT_SECRET.

**Mechanism:**
1. Host creates **plugin-scoped shared secret** (derived from JWT_SECRET + plugin name via HMAC)
2. Host signs JSON payload (user identity) with HMAC-SHA256
3. Host forwards payload + signature as HTTP headers to plugin
4. Plugin verifies signature using same derived secret
5. Plugin extracts user identity from verified payload

**Advantages:**
- Plugin never sees JWT_SECRET
- Plugin can't forge requests (needs signature key)
- Each plugin gets its own key (plugin compromise doesn't affect others)
- Stateless; no shared session storage needed
- Simple to implement and verify


---

## 8. Recommended RFC Design: HMAC User Identity Headers

### 8.1 Header Specification

**Headers added by host to plugin HTTP/WebSocket requests:**

```
X-Plugin-User-Payload: {"userId": 1, "username": "alice", "iat": 1714903200}
X-Plugin-User-Signature: sha256=a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0
X-Plugin-User-Algorithm: sha256
```

### 8.2 Payload Schema

```typescript
interface PluginUserPayload {
  userId: string | number;        // User ID from userDb
  username: string;                // Username
  iat: number;                     // Issued-at (Unix timestamp)
}
```

**Serialization:** JSON, UTF-8 encoded, then base64 for transport.

### 8.3 Signature Generation (Host Side)

```typescript
import crypto from 'crypto';

function generatePluginIdentityHeaders(
  user: { id: string | number; username: string },
  pluginName: string,
  jwtSecret: string
): { payload: string; signature: string } {
  // 1. Derive plugin-scoped HMAC key
  const pluginKey = crypto
    .createHmac('sha256', jwtSecret)
    .update(`plugin:${pluginName}`)
    .digest();  // Binary digest used as key

  // 2. Create payload
  const payload = {
    userId: user.id,
    username: user.username,
    iat: Math.floor(Date.now() / 1000),
  };
  const payloadStr = JSON.stringify(payload);

  // 3. Sign payload with derived key
  const signature = crypto
    .createHmac('sha256', pluginKey)
    .update(payloadStr)
    .digest('hex');

  return {
    payload: Buffer.from(payloadStr).toString('base64'),
    signature,
  };
}
```

### 8.4 Verification (Plugin Side)

```typescript
import crypto from 'crypto';

function verifyPluginIdentity(
  headers: { [key: string]: string },
  pluginName: string,
  pluginSharedSecret: string  // Shared secret provisioned to plugin
): { userId: string | number; username: string } | null {
  const payloadB64 = headers['x-plugin-user-payload'];
  const signature = headers['x-plugin-user-signature']?.split('=')[1];
  const algorithm = headers['x-plugin-user-algorithm'];

  if (!payloadB64 || !signature || algorithm !== 'sha256') {
    return null;
  }

  // 1. Decode payload
  const payloadStr = Buffer.from(payloadB64, 'base64').toString('utf-8');

  // 2. Recompute signature
  const expectedSignature = crypto
    .createHmac('sha256', Buffer.from(pluginSharedSecret, 'hex'))
    .update(payloadStr)
    .digest('hex');

  // 3. Constant-time comparison
  if (!crypto.timingSafeEqual(signature, expectedSignature)) {
    return null;
  }

  // 4. Parse and return payload
  const payload = JSON.parse(payloadStr);
  
  // 5. Replay protection: verify timestamp is recent
  if (payload.iat) {
    const now = Math.floor(Date.now() / 1000);
    if (now - payload.iat > 60) {
      return null;  // Payload > 1 minute old
    }
  }
  
  return { userId: payload.userId, username: payload.username };
}
```

### 8.5 Plugin Secret Provisioning

**At plugin startup**, host passes plugin-scoped secret via environment variable:

```javascript
const pluginProcess = spawn('node', [serverPath], {
  cwd: pluginDir,
  env: {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_ENV: process.env.NODE_ENV || 'production',
    PLUGIN_NAME: name,
    // NEW: Plugin receives its HMAC key
    PLUGIN_IDENTITY_KEY: crypto
      .createHmac('sha256', JWT_SECRET)
      .update(`plugin:${name}`)
      .digest('hex'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
```

**Advantages:**
- Key is process-scoped (not readable by sibling processes)
- Key is derived deterministically (host can recreate for verification)
- Key changes if plugin name changes (isolation)

### 8.6 WebSocket Integration

For WebSocket connections, headers are passed in the upgrade request:

```typescript
// In handlePluginWsProxy, after establishing upstream WS
const upstream = new WebSocket(
  `ws://127.0.0.1:${port}/ws`,
  [],
  {
    headers: {
      'X-Plugin-User-Payload': payload,
      'X-Plugin-User-Signature': signature,
      'X-Plugin-User-Algorithm': 'sha256',
    },
  }
);
```

---

## 9. Upstream Code Changes Required

### 9.1 Plugin Process Manager (proposed modification)

**File:** `server/utils/plugin-process-manager.ts`

Add HMAC key derivation to env:

```typescript
import crypto from 'crypto';

export function startPluginServer(
  name: string,
  pluginDir: string,
  serverEntry: string,
  jwtSecret: string  // NEW parameter
): Promise<number> {
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
      PLUGIN_IDENTITY_KEY: pluginKey,  // NEW
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // ... rest unchanged ...
}
```

### 9.2 Plugin Route Handler (proposed modification)

**File:** `server/routes/plugins.ts`

Add user identity headers to proxy (lines 207-283):

```typescript
import crypto from 'crypto';

router.all('/:name/rpc/*', async (req, res) => {
  // ... existing setup ...

  const headers = {
    'content-type': req.headers['content-type'] || 'application/json',
  };

  // NEW: Add user identity headers
  if (req.user) {
    const payload = {
      userId: req.user.id || req.user.userId,
      username: req.user.username,
      iat: Math.floor(Date.now() / 1000),
    };
    const payloadStr = JSON.stringify(payload);

    // Derive the same key used by plugin
    const pluginKey = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(`plugin:${pluginName}`)
      .digest();

    const signature = crypto
      .createHmac('sha256', pluginKey)
      .update(payloadStr)
      .digest('hex');

    headers['x-plugin-user-payload'] = Buffer.from(payloadStr).toString('base64');
    headers['x-plugin-user-signature'] = `sha256=${signature}`;
    headers['x-plugin-user-algorithm'] = 'sha256';
  }

  // ... rest of proxy unchanged ...
});
```

### 9.3 WebSocket Proxy (proposed modification)

**File:** `server/modules/websocket/services/plugin-websocket-proxy.service.ts`

Add headers to WebSocket upgrade:

```typescript
export function handlePluginWsProxy(
  clientWs: WebSocket,
  pathname: string,
  getPluginPort: (pluginName: string) => number | null,
  userPayload?: string,
  userSignature?: string,
  userAlgorithm?: string
): void {
  // ... validation ...

  const upgradeHeaders = {};
  
  if (userPayload && userSignature) {
    upgradeHeaders['X-Plugin-User-Payload'] = userPayload;
    upgradeHeaders['X-Plugin-User-Signature'] = userSignature;
    upgradeHeaders['X-Plugin-User-Algorithm'] = userAlgorithm || 'sha256';
  }

  const upstream = new WebSocket(`ws://127.0.0.1:${port}/ws`, [], {
    headers: upgradeHeaders,
  });

  // ... rest unchanged ...
}
```


---

## 10. v0.2.0 Implementation Plan: "claudecodeui-plugin-account"

### 10.1 Plugin Architecture

```
plugins/account/v0.2.0/
├── manifest.json              (declare server entry)
├── package.json
├── src/
│   ├── frontend/
│   │   ├── index.tsx          (React component, registers in UI)
│   │   ├── ChangePassword.tsx
│   │   ├── Account.tsx
│   │   └── api.ts             (frontend HTTP client)
│   └── backend/
│       ├── server.ts          (Express app, readiness protocol)
│       ├── auth.ts            (HMAC verification helper)
│       ├── routes.ts          (RPC endpoints)
│       └── handlers/
│           ├── changePassword.ts
│           ├── getCurrentUser.ts
│           └── updateProfile.ts
├── dist/
│   ├── index.js               (built frontend)
│   └── server.js              (built backend)
└── docs/
    └── PLUGIN_DEVELOPMENT.md
```

### 10.2 Manifest Configuration

```json
{
  "name": "account",
  "displayName": "Account",
  "version": "0.2.0",
  "description": "Manage your account: change username, password, and profile.",
  "author": "CloudCLI Contributors",
  "icon": "user.svg",
  "type": "react",
  "slot": "tab",
  "entry": "dist/index.js",
  "server": "dist/server.js",
  "permissions": ["user:read", "user:write"]
}
```

### 10.3 Backend Server Implementation

**File:** `src/backend/server.ts`

```typescript
import http from 'node:http';
import express from 'express';
import { verifyPluginIdentity } from './auth.js';
import * as handlers from './handlers/index.js';

const PLUGIN_IDENTITY_KEY = process.env.PLUGIN_IDENTITY_KEY;
if (!PLUGIN_IDENTITY_KEY) {
  console.error('[account] Missing PLUGIN_IDENTITY_KEY env var');
  process.exit(1);
}

const app = express();
app.use(express.json());

// Middleware: Extract and verify user identity
app.use((req: any, res: Response, next) => {
  const user = verifyPluginIdentity(req.headers, PLUGIN_IDENTITY_KEY);
  req.pluginUser = user || null;
  next();
});

// Middleware: Require authentication for protected endpoints
const requireAuth = (req: any, res: Response, next) => {
  if (!req.pluginUser) {
    return res.status(401).json({ error: 'User identity not available' });
  }
  next();
};

// Routes
app.post('/change-password', requireAuth, handlers.changePassword);
app.get('/current-user', requireAuth, handlers.getCurrentUser);
app.put('/profile', requireAuth, handlers.updateProfile);
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Start server
const server = http.createServer(app);
server.listen(0, '127.0.0.1', () => {
  const addr = server.address();
  if (addr && typeof addr !== 'string') {
    console.log(JSON.stringify({ ready: true, port: addr.port }));
  }
});

process.on('SIGTERM', () => {
  console.log('[account] Shutting down gracefully');
  server.close(() => process.exit(0));
});
```

### 10.4 Auth Helper

**File:** `src/backend/auth.ts`

```typescript
import crypto from 'crypto';

export interface PluginUser {
  userId: string | number;
  username: string;
}

export function verifyPluginIdentity(
  headers: Record<string, string>,
  pluginKey: string
): PluginUser | null {
  const payloadB64 = headers['x-plugin-user-payload'];
  const signatureHeader = headers['x-plugin-user-signature'];
  const algorithm = headers['x-plugin-user-algorithm'];

  if (!payloadB64 || !signatureHeader || algorithm !== 'sha256') {
    return null;
  }

  try {
    const payloadStr = Buffer.from(payloadB64, 'base64').toString('utf-8');
    const [algo, sig] = signatureHeader.split('=');
    
    if (algo !== 'sha256' || !sig) {
      return null;
    }

    const expectedSig = crypto
      .createHmac('sha256', Buffer.from(pluginKey, 'hex'))
      .update(payloadStr)
      .digest('hex');

    if (!crypto.timingSafeEqual(sig, expectedSig)) {
      return null;
    }

    const payload = JSON.parse(payloadStr);
    
    // Verify timestamp (within 1 minute)
    if (payload.iat) {
      const now = Math.floor(Date.now() / 1000);
      if (now - payload.iat > 60) {
        return null;
      }
    }

    return {
      userId: payload.userId,
      username: payload.username,
    };
  } catch (err) {
    console.error('[auth] Error verifying identity:', err);
    return null;
  }
}
```

### 10.5 Route Handler Example

**File:** `src/backend/handlers/changePassword.ts`

```typescript
import { Request, Response } from 'express';

export async function changePassword(req: any, res: Response) {
  const { currentPassword, newPassword } = req.body;
  const user = req.pluginUser;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Missing password fields' });
  }

  try {
    // Call host API to validate and change password
    // User identity is already verified via HMAC signature
    const response = await fetch('http://localhost:3000/api/user/change-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Plugin-User-ID': String(user.userId),
      },
      body: JSON.stringify({
        userId: user.userId,
        currentPassword,
        newPassword,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      return res.status(response.status).json(error);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[changePassword] Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}
```

### 10.6 Frontend API Client

**File:** `src/frontend/api.ts`

```typescript
const API_BASE = '/api/plugins/account/rpc';

export async function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<{ success: boolean }> {
  const res = await fetch(\`\${API_BASE}/change-password\`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword }),
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Password change failed');
  }

  return res.json();
}

export async function getCurrentUser(): Promise<{ username: string }> {
  const res = await fetch(\`\${API_BASE}/current-user\`);
  if (!res.ok) throw new Error('Failed to fetch user');
  return res.json();
}
```

### 10.7 Key Security Decisions

1. **Plugin identity is verified via HMAC:** Cannot forge user identity without plugin key
2. **Plugin key is process-scoped:** Not readable by other plugins or external code
3. **User context in handlers:** Each request carries the verified user; plugin must enforce own authorization
4. **Password handling:** Plugin validates current password before allowing change, uses bcrypt with salt
5. **Audit logging:** Plugin can log sensitive operations to host audit table

### 10.8 Testing Checklist

- [ ] Plugin manifest validates correctly
- [ ] Plugin server starts and reports ready port
- [ ] Frontend loads plugin UI in tab
- [ ] Backend receives HMAC-signed user identity headers
- [ ] Invalid signatures are rejected
- [ ] Current user endpoint returns correct user
- [ ] Change password validates old password
- [ ] Change password calls host API with correct user context
- [ ] Plugin server exits cleanly on SIGTERM
- [ ] Plugin disables/enables without errors

---

## 11. Implementation Blockers & Assumptions

### 11.1 Host-Side Changes Required (RFC Items)

**Before v0.2.0 can ship, these changes must land in host:**

1. **Plugin process manager:** Add PLUGIN_IDENTITY_KEY env var derivation
2. **Plugin HTTP proxy:** Add HMAC identity headers to forwarded requests
3. **Plugin WebSocket proxy:** Forward identity headers on upgrade
4. **No changes to plugin-loader.js:** Current manifest schema is sufficient

### 11.2 Plugin API Gap

Plugin's `changePassword` handler needs to call the host API to update the user's password.

**Assumption:** Host will provide password-change endpoint at:
```
POST /api/user/change-password
Authorization: Bearer <token> OR X-Plugin-User-ID: <id>
{ userId, currentPassword, newPassword }
```

This endpoint must:
- Verify requesting user owns the account being modified
- Validate current password
- Hash new password with bcrypt
- Persist to userDb
- Optionally log audit trail

### 11.3 Frontend Plugin Loading

Current analysis infers frontend plugin loading mechanism from backend code.

**Assumptions:**
- Frontend dynamically imports plugin `entry` (dist/index.js)
- Plugin exports React component or registration function
- Component is rendered in a tab UI slot
- Component can fetch from `/api/plugins/:name/rpc/*`

**To complete v0.2.0, need clarification from siteboon on:**
- Exact frontend plugin loading mechanism
- How plugins register themselves in UI
- Whether frontend has access to plugin manifest metadata

### 11.4 User Database Integration

**Assumptions about userDb:**
- Has `getUserById(id)` method
- User object has id, username, passwordHash (bcrypt or similar)
- Has `updateUserPassword(userId, newHash)` method
- Supports query methods for user CRUD

---

## 12. Data Flow Diagrams

### 12.1 Current Flow (WITHOUT User Identity - INSECURE)

```
Client (Browser)
    |
    | POST /api/plugins/account/rpc/change-password
    | Authorization: Bearer <JWT>
    v
Host Auth Middleware (auth.js:19)
    | Verifies JWT
    | req.user = { id: 1, username: "alice" }
    |
    | [USER IDENTITY EXISTS HERE]
    v
Plugin Route Handler (plugins.js:207)
    | Starts plugin server if needed
    | [IDENTITY DROPPED HERE - NOT FORWARDED]
    v
HTTP Proxy to 127.0.0.1:9876
    | POST /change-password
    | Content-Type: application/json
    | { newPassword: "..." }
    | [NO USER IDENTITY]
    v
Plugin HTTP Server
    | req.user = UNDEFINED
    | req.pluginUser = UNDEFINED
    |
    | [SECURITY RISK: Plugin doesn't know who's asking]
    v
Plugin Handler
    | Cannot identify user
    | Could change ANY user's password!
    v
Response (INSECURE)
```

### 12.2 Proposed Flow (WITH HMAC Headers - SECURE)

```
Client
    |
    v
Host Auth Middleware
    | req.user = { id: 1, username: "alice" }
    v
Plugin Route Handler [MODIFIED]
    | Derive HMAC key: HMAC(JWT_SECRET, `plugin:account`)
    | payload = JSON({ userId: 1, username: "alice", iat: <ts> })
    | signature = HMAC(key, payload)
    v
HTTP Proxy [MODIFIED]
    | Headers added:
    | X-Plugin-User-Payload: base64(payload)
    | X-Plugin-User-Signature: sha256=<sig>
    | X-Plugin-User-Algorithm: sha256
    v
Plugin HTTP Server [MODIFIED]
    | Middleware: verifyPluginIdentity(headers, PLUGIN_IDENTITY_KEY)
    | req.pluginUser = { userId: 1, username: "alice" } [VERIFIED]
    |
    | [USER IDENTITY VERIFIED AND AVAILABLE]
    v
Plugin Handler
    | Can identify user
    | Enforces per-user authorization
    | Changes only the requesting user's password
    v
Response (SECURE)
```

---

## 13. Security Analysis

### 13.1 Threat Model

**Assets:**
- User passwords
- User profile data
- User sessions

**Attackers:**
- Untrusted plugin code (malicious or compromised)
- Network eavesdropper on localhost
- Leaked plugin secrets from config

### 13.2 Attack Scenarios & Mitigations

| Scenario | Risk | Mitigation |
|----------|------|-----------|
| Plugin forges user identity | High | HMAC signature prevents forging without plugin key |
| Plugin reads other users' data | High | Plugin can only access authenticated user's data |
| Plugin's HMAC key is leaked | Medium | Only that plugin compromised; others unaffected |
| JWT_SECRET leaked to plugin | Critical | Not required; only derived key is shared |
| Localhost MITM | Low | Attacker can intercept if already has plugin key |
| Plugin secret leaked from config | Medium | Scope secrets properly; rotate keys regularly |

### 13.3 Best Practices for Plugin Developers

1. **Always verify identity headers** before making user-scoped decisions
2. **Never log user identity** in error messages to stdout
3. **Validate all user input** (passwords, profiles, etc.)
4. **Use bcrypt/Argon2** for password hashing, never plaintext
5. **Audit-log sensitive operations** (password changes, profile updates)
6. **Scope plugin secrets** narrowly (e.g., service-specific API keys)

---

## 14. Ambiguities & Open Questions

**These should be clarified with siteboon before RFC submission:**

1. **Frontend plugin loading mechanism**
   - How does frontend dynamically load plugin entry?
   - Is it a bundled React component? Raw JavaScript? ESM module?
   - How does it register itself in the UI?

2. **User database integration**
   - Does userDb expose password hash? Can plugins read it?
   - What hashing algorithm is used (bcrypt, scrypt, Argon2)?
   - Are there rate limits on failed login attempts?

3. **Plugin-to-host API calls**
   - Can plugin call host `/api/user/*` endpoints?
   - How does plugin authenticate to host when calling APIs?
   - Should we use same HMAC approach for plugin→host calls?

4. **Permissions enforcement**
   - When will manifest permissions be enforced?
   - Should certain plugins be restricted to admin users?

5. **WebSocket authentication**
   - Do plugins currently use WebSocket?
   - Should identity headers be added to WS upgrade?

6. **Multi-user / Platform mode**
   - In platform mode, how should plugins behave?
   - Should plugin still receive user identity headers?

---

## 15. Conclusion & Recommendations

### 15.1 Current State Summary

**Strengths:**
- Plugin isolation is excellent (subprocess model)
- Manifest validation is thorough
- Environment restriction prevents secret leakage
- Process management is clean and stateless

**Critical Gap:**
- Plugin servers have **no way to identify logged-in user**
- Makes account management impossible to implement securely
- Current gap: request reaches plugin without ANY auth context

### 15.2 Recommended Solution

Implement **HMAC-signed user identity headers** as specified in Section 8:
- Minimal change to host (3 locations)
- No shared JWT secret required
- Per-plugin HMAC keys derived deterministically
- Stateless verification

### 15.3 v0.2.0 Scope

For account plugin to be "pure" (no patches, no UI hacks):

**Required upstream changes:**
1. Plugin-process-manager: PLUGIN_IDENTITY_KEY env var
2. Plugin-routes HTTP proxy: HMAC identity headers
3. Plugin-routes WebSocket proxy: identity headers on upgrade

**Plugin implementation:**
1. Backend server with HMAC verification middleware
2. Frontend React component for account management
3. Endpoints for password change, profile update
4. Secure password validation using host API

**Blockers:**
- Host must provide password-change API endpoint
- Frontend plugin loading mechanism must be clarified
- userDb schema must support password hash operations

---

## 16. File References & Code Locations

| File | Purpose | Key Lines/Functions |
|------|---------|----------------------|
| `/usr/lib/node_modules/@cloudcli-ai/cloudcli/server/utils/plugin-loader.js` | Plugin discovery | lines 1-458 |
| `/usr/lib/node_modules/@cloudcli-ai/cloudcli/server/utils/plugin-process-manager.js` | Process lifecycle | startPluginServer() 15-105, startEnabledPluginServers() 167-183 |
| `/usr/lib/node_modules/@cloudcli-ai/cloudcli/server/routes/plugins.js` | HTTP proxy & management | router.all() 207-283 |
| `/usr/lib/node_modules/@cloudcli-ai/cloudcli/server/middleware/auth.js` | JWT validation | authenticateToken() 19-68 |
| `/usr/lib/node_modules/@cloudcli-ai/cloudcli/server/modules/websocket/services/plugin-websocket-proxy.service.ts` | WebSocket proxy | handlePluginWsProxy() 5-65 |
| `/usr/lib/node_modules/@cloudcli-ai/cloudcli/server/index.js` | Server bootstrap | lines 1-250+ |

---

## 17. Appendix: Complete Code Snippets

### A17.1: Plugin Startup (Current)

```javascript
// Host code
const pluginProcess = spawn('node', [serverPath], {
  cwd: pluginDir,
  env: { PATH, HOME, NODE_ENV, PLUGIN_NAME: name },
  stdio: ['ignore', 'pipe', 'pipe'],
});

// Plugin code must output:
console.log(JSON.stringify({ ready: true, port: addr.port }));
```

### A17.2: Plugin Startup (Proposed with HMAC)

```javascript
// Host code
const pluginKey = crypto
  .createHmac('sha256', JWT_SECRET)
  .update(`plugin:${name}`)
  .digest('hex');

const pluginProcess = spawn('node', [serverPath], {
  cwd: pluginDir,
  env: { PATH, HOME, NODE_ENV, PLUGIN_NAME: name, PLUGIN_IDENTITY_KEY: pluginKey },
  stdio: ['ignore', 'pipe', 'pipe'],
});
```

### A17.3: HTTP Proxy Headers (Proposed)

```javascript
// Host code (routes/plugins.js)
if (req.user) {
  const payload = JSON.stringify({
    userId: req.user.id,
    username: req.user.username,
    iat: Math.floor(Date.now() / 1000),
  });
  
  const pluginKey = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`plugin:${pluginName}`)
    .digest();

  const signature = crypto
    .createHmac('sha256', pluginKey)
    .update(payload)
    .digest('hex');

  headers['x-plugin-user-payload'] = Buffer.from(payload).toString('base64');
  headers['x-plugin-user-signature'] = `sha256=${signature}`;
  headers['x-plugin-user-algorithm'] = 'sha256';
}
```

### A17.4: Signature Verification (Plugin)

```typescript
// Plugin code
const payloadStr = Buffer.from(headers['x-plugin-user-payload'], 'base64').toString();
const sig = headers['x-plugin-user-signature'].split('=')[1];

const expectedSig = crypto
  .createHmac('sha256', Buffer.from(process.env.PLUGIN_IDENTITY_KEY, 'hex'))
  .update(payloadStr)
  .digest('hex');

if (!crypto.timingSafeEqual(sig, expectedSig)) {
  throw new Error('Invalid signature');
}

const user = JSON.parse(payloadStr);  // Now trusted!
```

---

**End of Analysis Document**

*Generated 2026-05-05 by thorough investigation of @cloudcli-ai/cloudcli v1.31.5*
*All file:line references are exact citations from the installed host package*

