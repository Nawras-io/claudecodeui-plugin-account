# Account Plug-in for Claude Code UI

A minimal plug-in that lets a self-hosted user change their own **username**
and **password** from inside the app. Two cards, no extra surface area.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
![Version](https://img.shields.io/badge/version-0.1.0-green.svg)

---

## Screenshots

### Plug-in installed and enabled
![Plugins screen](docs/screenshots/01-plugins-list.png)

### Account tab
![Account tab](docs/screenshots/02-account-tab.png)

### Change username + password
![Account full](docs/screenshots/03-account-full.png)

> The screenshots above show the plug-in integrated as a Settings tab. The
> default integration exposes it as a top-level **Account** tab in the main
> tab bar; tab placement is controlled by the host. See
> [Tab placement](#tab-placement) below.

---

## Features

- **Change username** — requires the current password. Pattern:
  `^[a-zA-Z0-9_]{3,32}$`. Returns `409` on conflict.
- **Change password** — requires the current password and a new one of
  ≥ 8 characters. Hashed with bcrypt cost 12.
- **Token refresh** — the server issues a fresh JWT after each successful
  change so the active session stays valid.
- **i18n** — English and Arabic out of the box.
- **Platform mode aware** — when the host runs with `IS_PLATFORM=true` the
  endpoints return `403` and the plug-in degrades cleanly.

## Scope

In:
- Self-service username/password change for the currently signed-in user.

Out (by design — file an issue if you need them):
- Admin / multi-user management.
- Roles and permissions.
- Password reset by email.
- 2FA / MFA.
- Active session listing or remote sign-out.

---

## Requirements

- A self-hosted [Claude Code UI](https://github.com/cloudcli-ai/cloudcli-ui)
  instance you control (i.e. not the hosted platform).
- Node.js ≥ 18 to build the plug-in.
- One-time **server patch** applied to the host (see
  [`server-patch/`](server-patch/README.md)). The plug-in calls
  `PUT /api/auth/account/{username,password}` which the upstream host does
  not expose by default.

---

## Install

### 1. Apply the server patch (one-time)

From the **host repo root**:

```bash
git apply path/to/plugins/account/server-patch/auth-routes.patch
git apply path/to/plugins/account/server-patch/users-repository.patch
```

Restart the host server. See [`server-patch/README.md`](server-patch/README.md)
for the manual fallback.

### 2. Install the plug-in

```bash
git clone https://github.com/iRukhaimi/claudecodeui-plugin-account
cd claudecodeui-plugin-account
npm install
npm run build
```

Drop the folder where the host scans for plug-ins:

```bash
mkdir -p ~/.claude-code-ui/plugins
ln -sfn "$(pwd)" ~/.claude-code-ui/plugins/account
```

(Or copy the folder if you prefer not to symlink.)

### 3. Enable

Open the host UI → **Settings → Plugins** → toggle **Account** on. A new
**Account** tab appears in the main tab bar.

---

## Tab placement

By default the host renders this plug-in as a top-level tab (manifest
`slot: "tab"`). If you prefer it to live inside Settings — like in the
screenshots — that requires a small change to the host's
`SettingsSidebar` and `Settings.tsx`. The plug-in itself does not modify
the host UI.

---

## Endpoints used

| Endpoint                       | Provided by       | Method |
| ------------------------------ | ----------------- | ------ |
| `/api/auth/user`               | upstream host     | GET    |
| `/api/auth/account/username`   | this server-patch | PUT    |
| `/api/auth/account/password`   | this server-patch | PUT    |

The plug-in reads the JWT from `localStorage["auth-token"]` (the host key)
and persists the refreshed token returned after each successful change.

---

## Project layout

```
plugins/account/
├── manifest.json           # Host plug-in manifest
├── package.json            # Build script (esbuild)
├── tsconfig.json
├── user.svg                # Tab icon
├── src/
│   ├── index.ts            # mount/unmount entry
│   ├── api.ts              # fetch helpers + token refresh
│   ├── i18n.ts             # en + ar
│   └── ui.ts               # plain-DOM helpers (no React dep)
├── dist/index.js           # Bundled output (committed for ease of install)
├── docs/screenshots/
└── server-patch/           # Host backend additions
```

The plug-in is plain TypeScript bundled by `esbuild` into a single ESM
module. It has **zero runtime dependencies** beyond the browser.

---

## Develop

```bash
npm run build               # build once
npx esbuild src/index.ts \
  --bundle --format=esm --target=es2020 \
  --outfile=dist/index.js --watch        # watch mode
```

The host loads the plug-in via `mount(container, api)` and tears it down
with `unmount(container)`.

---

## Security model

- All endpoints require a valid Bearer token (host's `authenticateToken`).
- Both changes require the current password — defends against a stolen
  in-memory token being escalated into permanent account takeover.
- bcrypt cost 12 (matches the host).
- Username uniqueness is enforced by the DB; the route maps the SQLite
  `UNIQUE` violation to a `409` response.
- Disabled in platform mode (`IS_PLATFORM=true`) so a hosted multi-tenant
  deployment cannot accidentally expose the surface.
- **Audit logging is not added** by this patch. If your deployment is
  subject to PDPL / SOX / similar, wire an audit hook in
  `routes/auth.js` after each successful change.

---

## License

AGPL-3.0-or-later — same as the host project. See [`LICENSE`](LICENSE).
