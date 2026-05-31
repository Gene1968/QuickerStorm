# Friends/Contacts Rights, Add-Friend, and Notifications — Design

Date: 2026-05-30
Status: Approved design, pre-plan
Builds on: `2026-05-29-social-easy-wins-design.md` (gridSocialStore, useSocial, ConversationsFloater Contacts tab)

## Goal

Bring the Contacts tab and notification experience to Firestorm parity:

1. **Friend permission checkboxes** — 5 per friend (3 you-grant editable + 2 friend-grants-you read-only), matching `panel_fs_contacts_friends.xml`.
2. **7-button action bar** — IM, Profile, Teleport, Map, Pay, Remove, Add (replacing the current 3 hover buttons), enabled-when-able.
3. **Add friends** — by typed name (avatar-picker search) and from the right-click avatar menu.
4. **Receive + accept friend requests** — incoming offer surfaces as a toast (Accept/Decline) and persists in the Notifications floater.
5. **System notifications** — toasts that stack on the right edge of the canvas and fade after a few seconds; also logged in a Notifications floater with `System / Transactions / Invitations / Group` tabs (System wired; other three placeholder).

## Decisions (locked with user)

- **Layout:** Firestorm-style full table inside the existing Contacts tab of `ConversationsFloater`. No compact compromise.
- **Action buttons:** Wire IM, Profile, Teleport, Map, Remove, Add. **Pay disabled** (tooltip). **One IM button**; its Call function is disabled until voice-call exists.
- **Friend requests:** Toast **and** Notifications floater System tab (persists if toast fades).
- **Add-friend:** Build real **name search** via `AvatarPickerRequest`/`AvatarPickerReply`, plus right-click avatar menu entry. (Not UUID-only.)
- **Architecture:** Approach A — dedicated `notificationStore` + `useNotifications`, new `ToastStack.vue` and `NotificationsFloater.vue`. Keeps the existing `*Store` / `use*` separation.

## Current state (verified)

Client (`gridSocialStore.js`, `useSocial.js`, `ConversationsFloater.vue`):
- `gridSocialStore` already models rights bits: `RIGHT_ONLINE=1`, `RIGHT_MAP=2`, `RIGHT_MODIFY=4`; per-friend `{ id, name, rightsGiven, rightsHas, online }`.
- `useSocial` already exposes `offerFriendship`, `respondFriendship`, `removeFriend`, `setFriendRights`, plus inbound handlers for `S.FRIEND_STATUS`, names, profiles.
- Contacts tab currently shows 3 hover buttons (Profile / IM / Remove), no checkboxes, no context menu on rows.
- No toast or notification UI exists anywhere.
- Right-click avatar menu (`AvatarContextMenu.vue`) has Send IM / View Profile / Face Toward (+ disabled stubs).

Server (`server/handlers/lludp.ts`, `server/lib/lludp-codec.ts`):
- Outbound implemented: OfferFriendship (IM dialog 38), AcceptFriendship (Low 297), DeclineFriendship (Low 298), TerminateFriendship (Low 300), ChangeUserRights (Low 321).
- Inbound implemented: ImprovedInstantMessage → `S.IM_RECV` (carries `dialog` and `imId` = transactionId); Online/OfflineNotification → `S.FRIEND_STATUS`; buddy list seeded at login with rights.
- **Gaps:** no inbound `ChangeUserRights` (Low 321) decode → remote rights changes don't reflect without relogin; no `AvatarPickerRequest/Reply`; no generic `AlertMessage`/`AgentAlertMessage` relay.

Packet facts (verified vs `message_template.msg`):
- `AvatarPickerRequest` Low 26: `AgentData{AgentID, SessionID, QueryID}`, `Data{Name Variable 1}`.
- `AvatarPickerReply` Low 28: `AgentData{AgentID, QueryID}`, `Data` (Variable array) `{AvatarID, FirstName Variable 1, LastName Variable 1}`.
- `ChangeUserRights` Low 321 (inbound shape): `AgentData{AgentID}`, `Rights` (Variable) `{AgentRelated LLUUID, RelatedRights S32}`.

## Architecture

```
ConversationsFloater (Contacts tab) ── rebuilt as FS table
        │  reads gridSocialStore.friends, emits via useSocial
        ▼
useSocial ──► server (offer/accept/decline/remove/rights/avatar-picker)
   ▲  └──◄ S.IM_RECV(dialog 38/39/40), S.FRIEND_STATUS,
   │        S.FRIEND_RIGHTS_CHANGED (new), S.AVATAR_PICKER_REPLY (new)
   │
useNotifications ──► notificationStore (toasts[] + items[])
        │                     ▲
        ▼                     │
   ToastStack.vue      NotificationsFloater.vue (4 tabs)
   (canvas right edge)  (FloaterWindow + uiStore.showNotifications)
```

## Components

### 1. `notificationStore` (new — `src/stores/notificationStore.js`)

State:
- `toasts: ref([])` — `{ id, kind, title, body, icon, actions, createdAt, sticky }`. `kind ∈ {info, offer, error}`. `actions: [{ label, variant, run }]`. `sticky` = don't auto-fade (offers).
- `items: ref([])` — persistent log `{ id, tab, title, body, actions, read, ts }`. `tab ∈ {system, transactions, invitations, group}`.

Actions:
- `pushToast(t) -> id` / `dismissToast(id)`.
- `addItem(i) -> id` / `removeItem(id)` / `markRead(id)` / `clearTab(tab)`.
- `notify({ tab, title, body, icon, actions, toast, sticky })` — convenience: adds an item and (if `toast`) a toast referencing the same id, so actioning one clears both.

Getters: `unreadCount(tab)`, `tabItems(tab)`, `totalUnread`.

No timers in the store; the component owns fade timing. IDs from a monotonic counter (no `Date.now()` for id; `ts` uses `Date.now()` at call site only).

### 2. `useNotifications` (new — `src/composables/useNotifications.js`)

Thin domain helpers over the store:
- `notifyFriendOffer({ fromId, fromName, transactionId, message })` → `notify` with `tab:'system'`, `sticky:true`, toast + item, Accept/Decline actions calling back into `useSocial`.
- `notifyInfo(text)` / `notifyError(text)` → transient toast + system item.
- Dedup offers by `transactionId` (ignore duplicates while one is pending).

### 3. Friend-offer flow (`useSocial.js` extensions)

- On `S.IM_RECV`: if `dialog === 38` → `notifyFriendOffer({ fromId: d.fromAgentId, fromName: d.fromAgentName, transactionId: d.imId, message: d.message })`. If `dialog === 39` (accepted) → `social.addFriend(d.fromAgentId, d.fromAgentName)` + `notifyInfo("<name> accepted your friendship offer.")`. If `dialog === 40` (declined) → `notifyInfo("<name> declined your friendship offer.")`. Non-friendship dialogs unchanged (IM path).
- Accept action → `respondFriendship(transactionId, true)`, optimistic `social.addFriend(fromId, fromName)`, clear the notification item+toast. Decline → `respondFriendship(transactionId, false)`, clear.
- `offerFriendship(id, name)` already exists; on send, push an outgoing `notifyInfo("You offered friendship to <name>.")`.
- New handler `S.FRIEND_RIGHTS_CHANGED` → `social.applyRightsChange({ agentId, rightsGiven?, rightsHas? })`.
- New handler `S.AVATAR_PICKER_REPLY` → resolve the pending picker query (see §7).

### 4. `gridSocialStore` extensions

- `addFriend(id, name = '', rightsGiven = 0, rightsHas = 0)` — idempotent insert (lowercased id); used for optimistic add on accept/accepted.
- `applyRightsChange({ agentId, rightsGiven, rightsHas })` — patch one friend's bits when defined.
- `setRightsGivenLocal(id, bitmask)` — optimistic local update used by checkbox toggles before server confirm.
- Keep existing `removeFriend` semantics (the store mutation; UDP via useSocial).

### 5. `ToastStack.vue` (new — `src/components/`)

- Fixed container, top-right of the canvas, `z-index` above floaters (use a value above the `floaterStack` ceiling).
- Renders `notificationStore.toasts`, newest on top, stacked downward with a small gap.
- Each toast: icon, title, body, optional action buttons (Accept/Decline for offers).
- Auto-fade: non-sticky toasts dismiss after ~6s (CSS fade-out ~0.4s); sticky (offers) stay until actioned. Hovering a toast pauses its timer. Timers tracked per-id, cleared on dismiss and on unmount.
- Clicking an action runs `action.run()` then dismisses.

### 6. `NotificationsFloater.vue` (new — `src/components/`)

- Wrapped in `FloaterWindow` (id `'notifications'`), following the established floater pattern.
- Header tabs with counts: `System (#) | Transactions (#) | Invitations (#) | Group (#)`.
- **System** tab: scrollable list of `tabItems('system')` (newest first), per-item action buttons, "Clear all" footer button. Clicking an unread item marks it read.
- **Transactions / Invitations / Group**: placeholder empty-state text ("No transactions yet.", etc.). Counts wired (will read 0 until those sources exist).
- `uiStore`: add `showNotifications` ref + `toggleNotifications()`, register `'notifications'` in `_FLOATER_CLOSE` and `floaterStack`. Mount `<NotificationsFloater v-if="ui.showNotifications" />` in `WorldView.vue`.
- Toolbar/menu entry (bell icon) opens it, with an unread badge from `totalUnread`.

### 7. Add-friend by name (avatar picker)

Client:
- `useSocial.findAvatars(query)` → emits `C.AVATAR_PICKER_REQ { query, queryId }`, returns a promise/ref resolved by `S.AVATAR_PICKER_REPLY` (match on `queryId`). Results `[{ id, name }]`.
- Contacts **Add** button opens a small inline picker (text input + results list); selecting a result calls `offerFriendship(id, name)`.

Server (`server/`):
- `shared/protocol.js`: add `C.AVATAR_PICKER_REQ = 'avatar_picker_req'` and `S.AVATAR_PICKER_REPLY = 'avatar_picker_reply'`.
- `lludp-codec.ts`: `encodeAvatarPickerRequest({ agentId, sessionId, queryId, name, seq })` (Low 26); `decodeAvatarPickerReply(buf, off)` → `{ queryId, avatars: [{ id, firstName, lastName }] }` (Low 28).
- `lludp.ts`: handle `C.AVATAR_PICKER_REQ` → build + send AvatarPickerRequest (track reliable); decode inbound Low 28 → relay `S.AVATAR_PICKER_REPLY { queryId, avatars: [{ id, name }] }`.

### 8. Right-click avatar menu (`AvatarContextMenu.vue`)

- Add **"Add Friend"** item, shown only when `!social.isFriend(menu.agentId)` → `offerFriendship(menu.agentId, menu.name)` + outgoing toast.
- (Existing Send IM / View Profile / Face Toward unchanged.)

### 9. Server: inbound ChangeUserRights (Low 321)

- `lludp-codec.ts`: `decodeChangeUserRights(buf, off)` → `{ rights: [{ agentRelated, relatedRights }] }`.
- `lludp.ts`: handle inbound Low 321 → for each entry relay `S.FRIEND_RIGHTS_CHANGED { agentId: agentRelated, rightsGiven: relatedRights }`. (The sim sends the rights *you* granted; `rightsHas` direction, if delivered separately, patched when present.)

## Contacts table (FS parity) — layout detail

Per row, left→right:
1. Online dot (green/grey).
2. Name (resolved; fallback short id).
3. `online` checkbox — editable — bit `RIGHT_ONLINE` of `rightsGiven`. Tooltip "Friend can see when you're online".
4. `map` checkbox — editable — bit `RIGHT_MAP` of `rightsGiven`. Tooltip "Friend can locate you on the map".
5. `edit` checkbox — editable — bit `RIGHT_MODIFY` of `rightsGiven`. Tooltip "Friend can edit, delete or take your objects".
6. `their-map` checkbox — **read-only** — bit `RIGHT_MAP` of `rightsHas`. Tooltip "You can locate them on the map".
7. `their-edit` checkbox — **read-only** — bit `RIGHT_MODIFY` of `rightsHas`. Tooltip "You can edit this friend's objects".

Editable toggle: flip bit in `rightsGiven` → `setRightsGivenLocal(id, mask)` (optimistic) → `setFriendRights(id, mask)` (UDP). Reconciled by `S.FRIEND_RIGHTS_CHANGED`.

Single-row selection drives the action bar (below the list):
`[ IM ] [ Profile ] [ Teleport ] [ Map ] [ Pay ] [ Remove ] [ Add ]`
- IM → `im.openWith(id, name)` + switch to IM tab. (Call portion disabled until voice.)
- Profile → `ui.openProfile(id)`.
- Teleport → offer-teleport to friend; reuse existing TP/offer path if present, else disabled when not available.
- Map → center friend on minimap/map (enabled only if `rightsHas & RIGHT_MAP` and online).
- Pay → **disabled** (tooltip "Not yet available").
- Remove → confirm → `removeFriend(id)`.
- Add → opens the avatar-picker (works without a selected friend).
- Enable-when-able: IM/Profile/Remove require a selection; Teleport/Map gated as above; Add always enabled.

## Error handling & edges

- Optimistic friend adds carry `rightsGiven/rightsHas = 0` until the next login refreshes the real buddy list.
- Duplicate incoming offers deduped by `transactionId`.
- Rights toggle is best-effort optimistic; if no server confirm arrives it simply stays as set (sim is authoritative on relogin).
- Toast timers cleared on dismiss and component unmount; sticky offers never auto-clear.
- Avatar-picker results matched strictly by `queryId`; stale replies ignored.

## Testing

- Unit (Vitest): `notificationStore` (push/dismiss/unread/clearTab, item↔toast linkage); rights bitmask helpers (set/clear bit, given vs has); `gridSocialStore.addFriend` idempotency and `applyRightsChange`.
- Manual (live sim): offer→receive→accept/decline round trip; rights checkbox toggle reflected after `S.FRIEND_RIGHTS_CHANGED`; avatar-picker name search returns results and offer sends; toast stacking + fade; Notifications floater System tab persistence.
- LLUDP encode/decode for the new packets verified by byte-shape against `message_template.msg` (no live unit harness).

## Out of scope (this spec)

- Pay (L$ money system) and voice Call — buttons present but disabled.
- Transactions / Invitations / Group notification sources — tabs present as placeholders.
- Groups/group-IM changes beyond what already exists.

## File touch list

New: `src/stores/notificationStore.js`, `src/composables/useNotifications.js`, `src/components/ToastStack.vue`, `src/components/NotificationsFloater.vue`.
Edit: `src/components/ConversationsFloater.vue` (Contacts tab rebuild), `src/components/AvatarContextMenu.vue`, `src/stores/gridSocialStore.js`, `src/composables/useSocial.js`, `src/stores/uiStore.js`, `src/components/WorldView.vue`, toolbar/menu component (bell entry), `shared/protocol.js`, `server/lib/lludp-codec.ts`, `server/handlers/lludp.ts`.
