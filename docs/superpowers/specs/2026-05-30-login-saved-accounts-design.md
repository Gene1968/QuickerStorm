# Login Saved Accounts Design

**Date:** 2026-05-30
**Status:** Approved

## Overview

Replace per-grid single-credential storage with a multi-account saved-accounts system. Username field becomes a combobox showing all saved accounts as "Username @ GridName". Selecting an entry auto-switches the grid dropdown and populates the password. Inspired by Firestorm's `fspanellogin.cpp` login list behavior.

## Data Model

### localStorage key: `qs_saved_accounts`

```json
[
  {
    "username": "Gene Freenote",
    "gridNick": "osgrid",
    "password": "...",
    "lastUsed": 1748563200000
  },
  {
    "username": "Gene Freenote",
    "gridNick": "neverworld",
    "password": "...",
    "lastUsed": 1748476800000
  }
]
```

- `username`: as typed by user (display name)
- `gridNick`: matches `nick` field in `grids.json` / user grids
- `password`: plaintext (same security model as existing `qs_autologin_*` keys)
- `lastUsed`: `Date.now()` set on each successful login; drives sort order

Entries sorted by `lastUsed` descending (most recently used first) when rendered.

### Migration

On `accountsStore` initialization:
1. If `qs_saved_accounts` already exists → skip migration entirely
2. Scan localStorage for all keys matching `qs_autologin_*`
3. For each found key: import `{username, password}` as `{username, gridNick, password, lastUsed: 0}`
4. Write merged array to `qs_saved_accounts`
5. Delete all `qs_autologin_*` keys

## New Store: `src/stores/accountsStore.js`

```js
// Public API
accounts          // computed — array sorted by lastUsed desc, orphaned entries filtered out
addOrUpdate(username, gridNick, password)  // upsert by (username.toLowerCase(), gridNick); sets lastUsed = Date.now()
remove(username, gridNick)                 // removes matching entry
getPassword(username, gridNick)            // returns password string or null
```

**Orphan filtering:** `accounts` computed filters entries where `gridNick` has no match in `gridStore.allGrids`. Handles case where user deleted a custom grid that had saved credentials.

**Duplicate matching:** upsert key = `username.toLowerCase() + "@" + gridNick`. Two accounts with same case-insensitive username on same grid = one entry.

## LoginForm.vue Changes

### Username field

Replace `<input type="text">` with combobox pattern:

```html
<input
  v-model="username"
  type="text"
  list="qs-saved-accounts"
  placeholder="First Last"
  @change="onAccountSelect"
/>
<datalist id="qs-saved-accounts">
  <option
    v-for="acct in accountsStore.accounts"
    :key="acct.username + '@' + acct.gridNick"
    :value="acct.username + ' @ ' + gridStore.getGrid(acct.gridNick)?.name"
  />
</datalist>
```

Native `<datalist>` — no new dependencies, keyboard-navigable, free-form typing still works.

### `onAccountSelect` handler

Fires on `change` event (user picks from list or tabs away):

1. Check if value matches pattern `"Username @ GridName"`
2. Find matching entry in `accountsStore.accounts` by `gridNick` (match on `grid.name`)
3. If found:
   - `gridStore.selectGrid(entry.gridNick)`
   - Set `username.value` to `entry.username` (strip the `@ GridName` part)
   - Set `password.value` to `accountsStore.getPassword(entry.username, entry.gridNick)`
4. If not found (free-form typed value): no grid switch, no password inject

### Submit handler changes

Current behavior: saves `qs_autologin_<nick>` before login attempt, deletes on failure.

New behavior:
- **On successful login + remember-me checked:** `accountsStore.addOrUpdate(username, gridNick, password)`
- **On failed login:** no change to saved accounts (don't delete existing entry)
- **On successful login + remember-me unchecked:** do NOT call `addOrUpdate`; leave any existing entry untouched

Remove all `qs_autologin_*` read/write code from `LoginForm.vue`.

## Preferences Floater — Accounts Tab

Add "Accounts" section/tab to the existing Preferences floater (accessible from login screen).

### UI

```
Saved Accounts
──────────────────────────────────────────────
Gene Freenote @ OSGrid          Last used: today    [Remove]
Gene Freenote @ Neverworld Grid Last used: 3 days   [Remove]
──────────────────────────────────────────────
(empty state: "No saved accounts. Check 'Remember me' when logging in.")
```

- List sorted by `lastUsed` desc (same order as combobox)
- Last-used shown as relative date (today / N days ago / date)
- **Remove** button: calls `accountsStore.remove(username, gridNick)` → row disappears immediately
- No confirmation dialog (low-stakes, re-login restores)
- If removed account matches current combobox value → clear password field, leave grid unchanged

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Same username, same grid, different password | `addOrUpdate` overwrites password + lastUsed |
| Custom grid deleted, saved account orphaned | `accountsStore.accounts` filters it out; not shown in combobox or Preferences |
| Remember-me unchecked | No `addOrUpdate`; existing saved entry left untouched |
| Migration: `qs_saved_accounts` already exists | Skip migration; don't re-import old keys |
| Migration: partial (some `qs_autologin_*` keys gone) | Import whatever keys exist; no error on missing |
| Auto-reconnect flow (LandingView) | Unchanged; no interaction with `accountsStore` |

## Files Affected

| File | Change |
|------|--------|
| `src/stores/accountsStore.js` | **New** — full store |
| `src/components/LoginForm.vue` | Replace username input with combobox; update submit handler; remove `qs_autologin_*` logic |
| `src/components/PreferencesFloater.vue` | Add Accounts section |
| `src/components/GridSelector.vue` | No change |
| `src/stores/gridStore.js` | No change |
