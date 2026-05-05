# Changelog

All notable changes to this plug-in will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- Re-licensed under **Apache 2.0** (was AGPL-3.0).
- Repository moved to `Nawras-io` org under AlKindy's open source initiative.
- README rewritten as bilingual (Arabic + English) with Nawras attribution.
- Added `NOTICE`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`.

### Added
- `host-ui-integration/` — optional patches that mount the plug-in inside
  the Settings page and add a Sign Out button to the sidebar.

## [0.1.0] — 2026-05-05

### Added
- Change username (requires current password).
- Change password (requires current password, ≥ 8 chars).
- Token refresh after each successful change.
- i18n: English and Arabic.
- Server patch shipped under `server-patch/` for host integration.
