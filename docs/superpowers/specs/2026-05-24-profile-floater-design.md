# Profile Floater Design

**Date:** 2026-05-24
**Status:** Approved

## Overview

New `ProfileFloater.vue` component — shows avatar profile for self (editable) or another user (read-only except Notes). Enabled via Avatar → Profile… in MenuBar. Follows Firestorm `panel_profile_secondlife.xml` field layout with horizontal top tabs.

## Tabs

Five tabs, horizontal row at top of floater:

| Tab | Self | Other | Phase |
|-----|------|-------|-------|
| Profile | pic placeholder, about editable | all read-only | Now |
| Interests | disabled ("soon") | disabled ("soon") | Later |
| Picks | disabled ("soon") | disabled ("soon") | Later |
| First Life | disabled ("soon") | disabled ("soon") | Later |
| Notes | editable textarea | editable textarea | Now |

Disabled tabs render with muted label and "soon" badge (same pattern as PreferencesFloater).

## Profile Tab Fields

Top section — avatar pic left, name/status right:

- **Avatar pic** — 158×158 placeholder image (Generic_Person). No upload in Phase 1.
- **Display Name** — read-only text. Bold.
- **Online indicator** — bold `Online` (green, `text-green-400`) or `Offline` (red, `text-red-400`) text. `v-if="!isSelf"`. Value sourced from `presenceStore` by `profileTargetId`; defaults to `Offline` if unknown.

Fields below pic/name block:

| Field | Label | Editable (self) | Editable (other) | Source |
|-------|-------|-----------------|------------------|--------|
| UUID | Key | No | No | `avatarStore.authUserId` (self) / prop |
| Born | Born | No | No | `avatarStore.born` stub — "N/A" |
| Account | Account | No | No | `avatarStore.accountType` stub — "Resident" |
| Partner | Partner | No | No | `avatarStore.partner` stub — "None" |
| Groups | Groups | No | No | `avatarStore.groups` stub — empty list |
| About | (none) | Yes — textarea | No — read-only textarea | `avatarStore.bio` |

Save / Discard buttons appear bottom-right when self AND `bio` is dirty.

## Notes Tab

Single editable textarea (full height). Private — stored locally in `localStorage` keyed by target UUID. Not synced to server in Phase 1.

## Friend Permission Icons (other + friend only)

Three icon pairs in a row below online indicator — stub visibility only (no real data in Phase 1):

1. Can / cannot see online status
2. Can / cannot see on map
3. Can / cannot modify objects

`v-if="!isSelf && isFriend"` — `isFriend` always `false` in Phase 1 (icons hidden).

## Bottom Action Buttons

Shown only when `!isSelf`:

| Button | Enabled Phase 1 | Friend only |
|--------|----------------|-------------|
| IM | No (disabled stub) | No |
| Pay | No (disabled stub) | No |
| Block | No (disabled stub) | No |
| Find on Map | No (disabled stub) | Yes |
| Offer Teleport | No (disabled stub) | Yes |
| Remove Friend | No (disabled stub) | Yes |

All disabled in Phase 1 — render with `disabled` class, no handlers.

## State Changes

### uiStore

Add:
```js
showProfile: false,
profileTargetId: null,   // null = self; UUID string = other user
```

Add actions:
```js
openProfile(id = null) {
  this.profileTargetId = id
  this.showProfile = true
},
toggleProfile() {
  this.showProfile = !this.showProfile
},
```

### avatarStore

Add stub fields (no persistence in Phase 1):
```js
bio: '',
born: null,
accountType: 'Resident',
partner: null,
groups: [],
```

### App.vue

Mount `<ProfileFloater />` alongside other floaters.

### MenuBar.vue

Wire Avatar → Profile… item:
```js
{ label: 'Profile…', kbd: null, act: () => ui.openProfile() }
```

Remove `disabled: true` from that item.

## Component Structure

`src/components/ProfileFloater.vue` — follows PreferencesFloater pattern:
- `<script setup>` with `uiStore`, `avatarStore`, `presenceStore`
- Draggable positioning: `absolute`, centered via CSS transform
- Horizontal tab bar: `flex flex-row` strip at top
- `isSelf` computed: `profileTargetId === null`
- Close on Esc, backdrop click, or × button
- `activeTab` ref, default `'profile'`

## Styling

- Tab strip: horizontal `flex` row, active tab underline accent color
- Floater width: `28rem` (448px) — wider than MapFloater, similar to PreferencesFloater
- Height: `32rem` (512px) fixed
- Tailwind tokens: `bg-card`, `text-t1`, `border-brd`, `text-accent` — consistent with other floaters

## Out of Scope (Phase 1)

- Profile pic upload
- Real born date / account type from grid
- Groups list from grid
- Partner data
- IM, Pay, Block, Find, Offer TP, Remove Friend functionality
- Friend detection
- Notes sync to server
- Interests, Picks, First Life tab content
