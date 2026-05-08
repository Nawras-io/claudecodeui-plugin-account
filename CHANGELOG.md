# Changelog

All notable changes to this plug-in will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `docs/internal/cloudcli-plugin-system-analysis.md` — deep technical
  analysis of the cloudcli plugin subsystem (loader, process manager,
  HTTP/WS proxy, auth context) used as the basis for the upstream RFC.
- `docs/internal/upstream-rfc-issue.md` — draft of the upstream RFC,
  filed as [siteboon/claudecodeui#744](https://github.com/siteboon/claudecodeui/issues/744).

### Changed
- `README` — added bilingual **Roadmap** section covering v0.1.x
  (current, manual integration with patches) and v0.2.0 (planned pure
  plug-in pending upstream RFC), a "Why two versions?" subsection
  referencing `docs/internal/cloudcli-plugin-system-analysis.md`
  §3-4 and §7, an advanced-users note in both install sections, and
  a Status badge/paragraph clarifying current stable v0.1.1 and next
  planned v0.2.0. Tracking issue link wired to
  [siteboon/claudecodeui#744](https://github.com/siteboon/claudecodeui/issues/744).
  Documentation-only; no code or version bump.

## [0.1.2] — 2026-05-09

### Changed
- Declared `slot` as `settings-section` so the plug-in renders inside the
  host's Settings sidebar instead of the main top tab bar (requires host
  with the `settings-section` slot whitelisted, e.g.,
  `Claudecodeui-enhanced-appearance` or any cloudcli >= the version that
  adds this slot).

## [0.1.1] — 2026-05-05

### Changed
- **License corrected to `AGPL-3.0-or-later`** to match the upstream
  host ([siteboon/claudecodeui](https://github.com/siteboon/claudecodeui)).
  The patches under `server-patch/` and `host-ui-integration/` modify
  AGPL-3.0 source and constitute a derivative work; v0.1.0's
  `Apache-2.0` designation was incorrect and is superseded.
  **Users who consumed v0.1.0 should upgrade.**
- `NOTICE` rewritten with AGPL terms, upstream attribution, and a clear
  Anthropic trademark disclaimer ("Claude" is a trademark of Anthropic;
  this plug-in is independent and not affiliated).
- `README` updated with: license badge → AGPL-3.0, upstream attribution
  block, "Not affiliated with Anthropic / siteboon" disclaimer,
  Troubleshooting section.

### Added
- `host-ui-integration/ui-integration.patch` now also filters the
  `account` plug-in out of the top tab bar
  (`MainContentTabSwitcher.tsx`), so the plug-in only renders inside
  Settings when the optional UI integration is applied — avoiding
  duplicate "Account" entries.
- `docs/API.md` — request/response/error reference with `curl` examples.

## [0.1.0] — 2026-05-05

> ⚠️ **Superseded by 0.1.1.** v0.1.0 was tagged as `Apache-2.0`; that
> designation was incorrect (see 0.1.1). Functionality is unchanged.

### Added
- Change username (requires current password, `^[a-zA-Z0-9_]{3,32}$`).
- Change password (requires current password, ≥ 8 chars, bcrypt cost 12).
- Token refresh after each successful change.
- i18n: English and Arabic.
- `server-patch/` for host integration (auth routes + users repo).
- `host-ui-integration/` optional Settings integration.
- Bilingual `README`, `NOTICE`, `CONTRIBUTING.md`, `SECURITY.md`,
  `CODE_OF_CONDUCT.md`.
- Screenshots in `docs/screenshots/`.
