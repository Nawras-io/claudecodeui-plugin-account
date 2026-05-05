# Host UI integration (optional)

> ⚠️ **Optional.** The plug-in itself works without these changes — it just
> shows up as a top-level tab. Apply this only if you want the layout shown
> in the screenshots: an "Account" item inside the Settings sidebar plus a
> "Sign Out" button at the bottom.

## What this adds to the host

1. New **Account** entry in the Settings sidebar that mounts the plug-in
   inside the Settings page (instead of as a top-level tab).
2. **Sign Out** button at the bottom of the Settings sidebar (desktop) and
   as an icon in the mobile pill bar.
3. Hides the `account` plug-in from the top-level tab bar (so it isn't
   shown in two places at once).
4. Adds the `mainTabs.account` translation key for all 8 supported locales.

## Files touched in the host

- `src/components/settings/types/types.ts`
- `src/components/settings/constants/constants.ts`
- `src/components/settings/hooks/useSettingsController.ts`
- `src/components/settings/view/Settings.tsx`
- `src/components/settings/view/SettingsSidebar.tsx`
- `src/components/main-content/view/subcomponents/MainContentTabSwitcher.tsx`
- `src/i18n/locales/{de,en,it,ja,ko,ru,tr,zh-CN}/settings.json`

Plus a new file:
- `src/components/settings/view/tabs/AccountSettingsTab.tsx`

## Apply

From the **host repo root** (Claude Code UI):

```bash
# 1) Drop the new tab component
mkdir -p src/components/settings/view/tabs
cp path/to/plugins/account/host-ui-integration/AccountSettingsTab.tsx \
   src/components/settings/view/tabs/AccountSettingsTab.tsx

# 2) Apply the diff
git apply path/to/plugins/account/host-ui-integration/ui-integration.patch
```

If the patch rejects (upstream evolved), open `ui-integration.patch` and
port the changes manually — they are small.

## Behaviour after apply

- The plug-in's tab no longer appears in the top main tab bar.
- It appears at the **top of the Settings sidebar** (above "Agents").
- The Settings sidebar gains a **Sign Out** button at the bottom that calls
  the host's existing `useAuth().logout()` (no new endpoint required —
  this uses `/api/auth/logout` already in upstream).

## Reverting

```bash
git apply -R path/to/plugins/account/host-ui-integration/ui-integration.patch
rm src/components/settings/view/tabs/AccountSettingsTab.tsx
```
