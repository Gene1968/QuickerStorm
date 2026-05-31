# Friends/Contacts Rights, Add-Friend, and Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the Contacts tab to Firestorm parity (5 permission checkboxes + 7-button action bar), add friends by name (avatar picker) and from the right-click menu, receive/accept friend requests, and add a toast + tabbed Notifications system.

**Architecture:** Client-heavy. A new `notificationStore` + `useNotifications` feed a `ToastStack` (right-edge fade) and a tabbed `NotificationsFloater`. `gridSocialStore`/`useSocial` gain friend-offer routing, optimistic add, local rights toggles, and avatar-picker search. Three small server additions: `AvatarPickerRequest` (outbound), `AvatarPickerReply` (inbound), and inbound `ChangeUserRights` decode.

**Tech Stack:** Vue 3 `<script setup>` + Pinia, Bun WS server (TypeScript) + raw LLUDP codec, Vitest (jsdom for `src/`, node for `tests/server/`), Tailwind.

**Spec:** `docs/superpowers/specs/2026-05-30-friends-contacts-notifications-design.md`

**Conventions reminder:** Tabs (not spaces). Tailwind tokens (`bg-card`, `text-t1`, `border-brd`, `text-accent`, `bg-card2`, `text-tm`). Import via `@/` and `@shared/`. Run a single test file with `npx vitest run <path>`. Do **not** commit unless the user asks — the commit steps below stage + write a message, but ask the user before actually running `git commit` (project rule: the user commits).

---

## File Structure

**New files**
- `src/stores/notificationStore.js` — toasts[] + items[] state, push/dismiss/notify/group.
- `src/composables/useNotifications.js` — thin generic helpers over the store (notifyInfo/notifyError) + store re-export.
- `src/components/ToastStack.vue` — fixed top-right toast stack, auto-fade, action buttons.
- `src/components/NotificationsFloater.vue` — FloaterWindow with System/Transactions/Invitations/Group tabs.
- `tests/server/avatar-picker-codec.test.ts` — encode/decode byte-shape tests (vitest, node env).
- `src/__tests__/stores/notificationStore.test.js`, `src/__tests__/stores/gridSocialStore.rights.test.js` — unit tests.

**Modified files**
- `shared/protocol.js` — `C.AVATAR_PICKER_REQ`, `S.AVATAR_PICKER_REPLY`, `S.FRIEND_RIGHTS_CHANGED`.
- `server/lib/lludp-codec.ts` — `encodeAvatarPickerRequest`, `decodeAvatarPickerReply`, `decodeChangeUserRights`.
- `server/handlers/lludp.ts` — handle `C.AVATAR_PICKER_REQ`; decode inbound Low 28 + Low 321.
- `src/stores/gridSocialStore.js` — `addFriend`, `applyRightsChange`, `setRightsGivenLocal`, exported `hasRight`/`setRight`.
- `src/composables/useSocial.js` — friendship-IM routing, rights-changed handler, `findAvatars`, picker-reply handler.
- `src/components/ConversationsFloater.vue` — Contacts tab rebuilt as FS table + 7-button bar + Add picker.
- `src/components/AvatarContextMenu.vue` — "Add Friend" item.
- `src/stores/uiStore.js` — `showNotifications` + `toggleNotifications` + floater registration.
- `src/views/WorldView.vue` — mount `<NotificationsFloater>` and `<ToastStack>`.
- `src/components/BottomToolbar.vue` — bell button with unread badge (mirror existing toggle button).

---

## Task 1: Protocol constants

**Files:**
- Modify: `shared/protocol.js` (C block ~line 41, S block ~line 75)

- [ ] **Step 1: Add the client constant**

In `shared/protocol.js`, in the `C` object after `NAME_REQ` (line 41), add:

```javascript
	AVATAR_PICKER_REQ: 'avatar_picker_req', // { query, queryId } — AvatarPickerRequest (Low 26) for Add-Friend name search
```

- [ ] **Step 2: Add the server constants**

In the `S` object after `NAME_REPLY` (line 75), add:

```javascript
	AVATAR_PICKER_REPLY:  'avatar_picker_reply',  // { queryId, avatars:[{ id, name }] } — AvatarPickerReply (Low 28)
	FRIEND_RIGHTS_CHANGED:'friend_rights_changed',// { agentId, relatedId, rights } — inbound ChangeUserRights (Low 321)
```

- [ ] **Step 3: Sanity check it parses**

Run: `node -e "import('./shared/protocol.js').then(m=>console.log(m.C.AVATAR_PICKER_REQ, m.S.AVATAR_PICKER_REPLY, m.S.FRIEND_RIGHTS_CHANGED))"`
Expected: `avatar_picker_req avatar_picker_reply friend_rights_changed`

- [ ] **Step 4: Commit** (ask user first)

```bash
git add shared/protocol.js
git commit -m "feat(protocol): add avatar-picker + friend-rights-changed envelopes"
```

---

## Task 2: Server codec — avatar picker + inbound rights

**Files:**
- Modify: `server/lib/lludp-codec.ts` (add after `encodeChangeUserRights`, ~line 1776, and in the inbound-decoders section after `decodeUUIDNameReply`)
- Test: `tests/server/avatar-picker-codec.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/server/avatar-picker-codec.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
	encodeAvatarPickerRequest,
	decodeAvatarPickerReply,
	decodeChangeUserRights,
	uuidToBytes,
} from '../../server/lib/lludp-codec'

const A = '11111111-1111-1111-1111-111111111111'
const Q = '22222222-2222-2222-2222-222222222222'
const S = '33333333-3333-3333-3333-333333333333'

describe('encodeAvatarPickerRequest (Low 26)', () => {
	it('emits the Low 26 message number and a length-prefixed name', () => {
		const pkt = encodeAvatarPickerRequest({ agentId: A, sessionId: S, queryId: Q, name: 'Bob', seq: 5 })
		// Find the Low message-number marker FF FF 00 1A
		const idx = pkt.indexOf(Buffer.from([0xff, 0xff, 0x00, 0x1a]))
		expect(idx).toBeGreaterThanOrEqual(0)
		const body = pkt.subarray(idx + 4)
		expect(body.subarray(0, 16).equals(uuidToBytes(A))).toBe(true)
		expect(body.subarray(16, 32).equals(uuidToBytes(S))).toBe(true)
		expect(body.subarray(32, 48).equals(uuidToBytes(Q))).toBe(true)
		const len = body[48]
		expect(len).toBe(4) // "Bob" + NUL
		expect(body.subarray(49, 49 + 3).toString('utf8')).toBe('Bob')
	})
})

describe('decodeAvatarPickerReply (Low 28)', () => {
	it('decodes agentId, queryId, and the avatar array', () => {
		// Build a synthetic body: AgentID, QueryID, count=1, AvatarID, FirstName V1, LastName V1
		const av = '44444444-4444-4444-4444-444444444444'
		const first = Buffer.from('Bob\0', 'utf8')
		const last = Buffer.from('Linden\0', 'utf8')
		const body = Buffer.concat([
			uuidToBytes(A), uuidToBytes(Q), Buffer.from([1]),
			uuidToBytes(av), Buffer.from([first.length]), first,
			Buffer.from([last.length]), last,
		])
		const out = decodeAvatarPickerReply(body, 0)
		expect(out.queryId).toBe(Q.toLowerCase())
		expect(out.avatars).toEqual([{ id: av.toLowerCase(), firstName: 'Bob', lastName: 'Linden' }])
	})
})

describe('decodeChangeUserRights (Low 321)', () => {
	it('decodes the agent and the rights entries', () => {
		const related = '55555555-5555-5555-5555-555555555555'
		const body = Buffer.concat([
			uuidToBytes(A), Buffer.from([1]),
			uuidToBytes(related), (() => { const b = Buffer.alloc(4); b.writeInt32LE(3, 0); return b })(),
		])
		const out = decodeChangeUserRights(body, 0)
		expect(out.agentId).toBe(A.toLowerCase())
		expect(out.rights).toEqual([{ agentRelated: related.toLowerCase(), relatedRights: 3 }])
	})
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/server/avatar-picker-codec.test.ts`
Expected: FAIL — `encodeAvatarPickerRequest is not a function` (and the two decoders).

- [ ] **Step 3: Implement the encoder**

In `server/lib/lludp-codec.ts`, immediately after `encodeChangeUserRights` (line ~1776), add:

```typescript
/** AvatarPickerRequest (Low 26) — name search for Add-Friend.
 *  AgentData{AgentID, SessionID, QueryID}; Data{Name Variable 1 (NUL-terminated)}. */
export function encodeAvatarPickerRequest(p: { agentId: string; sessionId: string; queryId: string; name: string; seq: number }): Buffer {
  const hdr  = buildHeader({ seq: p.seq, reliable: true, hasAcks: false, zeroCoded: false })
  const name = Buffer.from((p.name || '') + '\0', 'utf8').subarray(0, 255)
  const body = Buffer.allocUnsafe(16 + 16 + 16 + 1 + name.length)
  let off = 0
  uuidToBytes(p.agentId).copy(body, off);   off += 16
  uuidToBytes(p.sessionId).copy(body, off); off += 16
  uuidToBytes(p.queryId).copy(body, off);   off += 16
  body[off++] = name.length
  name.copy(body, off)
  return Buffer.concat([hdr, Buffer.from([0xFF, 0xFF, 0x00, 0x1A]), body])  // Low 26
}
```

- [ ] **Step 4: Implement the decoders**

In the inbound-decoders section (after `decodeUUIDNameReply`, ~line 1800), add:

```typescript
/** AvatarPickerReply (Low 28). AgentData{AgentID, QueryID};
 *  Data Variable{AvatarID, FirstName V1, LastName V1}×N. */
export function decodeAvatarPickerReply(buf: Buffer, dataOffset: number): {
  agentId: string; queryId: string; avatars: { id: string; firstName: string; lastName: string }[]
} {
  let off = dataOffset
  const agentId = bytesToUuid(buf, off); off += 16
  const queryId = bytesToUuid(buf, off); off += 16
  const count = buf[off++]
  const avatars: { id: string; firstName: string; lastName: string }[] = []
  const readV1 = (): string => {
    const len = buf[off++]
    const s = buf.toString('utf8', off, off + len).replace(/\0+$/, '')
    off += len
    return s
  }
  for (let i = 0; i < count && off + 16 <= buf.length; i++) {
    const id = bytesToUuid(buf, off); off += 16
    const firstName = readV1()
    const lastName = readV1()
    avatars.push({ id, firstName, lastName })
  }
  return { agentId, queryId, avatars }
}

/** ChangeUserRights (Low 321) inbound. AgentData{AgentID};
 *  Rights Variable{AgentRelated LLUUID, RelatedRights S32}×N. */
export function decodeChangeUserRights(buf: Buffer, dataOffset: number): {
  agentId: string; rights: { agentRelated: string; relatedRights: number }[]
} {
  let off = dataOffset
  const agentId = bytesToUuid(buf, off); off += 16
  const count = buf[off++]
  const rights: { agentRelated: string; relatedRights: number }[] = []
  for (let i = 0; i < count && off + 20 <= buf.length; i++) {
    const agentRelated = bytesToUuid(buf, off); off += 16
    const relatedRights = buf.readInt32LE(off); off += 4
    rights.push({ agentRelated, relatedRights })
  }
  return { agentId, rights }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run tests/server/avatar-picker-codec.test.ts`
Expected: PASS (3 describe blocks green).

- [ ] **Step 6: Commit** (ask user first)

```bash
git add server/lib/lludp-codec.ts tests/server/avatar-picker-codec.test.ts
git commit -m "feat(codec): avatar-picker request/reply + inbound ChangeUserRights"
```

---

## Task 3: Server handlers — picker request out, picker reply + rights in

**Files:**
- Modify: `server/handlers/lludp.ts` (constants near line 65; inbound dispatch near line 719; outbound handler near line 1147 by `FRIEND_RIGHTS`)

- [ ] **Step 1: Add inbound message-number constants**

Near the other `LOW_*` constants (~line 65), add:

```typescript
const LOW_AVATAR_PICKER_REPLY = 28   // AvatarPickerReply
const LOW_CHANGE_USER_RIGHTS  = 321  // ChangeUserRights (inbound notification)
```

- [ ] **Step 2: Import the new codec functions**

In the existing import from `../lib/lludp-codec` at the top of `lludp.ts`, add `encodeAvatarPickerRequest`, `decodeAvatarPickerReply`, `decodeChangeUserRights` to the named imports.

- [ ] **Step 3: Add the outbound handler**

After the `FRIEND_RIGHTS` handler block (ends ~line 1156), add:

```typescript
	if (msg.t === C.AVATAR_PICKER_REQ) {
		const d = msg.d as { query: string; queryId: string }
		if (!d.query || !d.queryId) return
		const seq = nextSeq(session)
		const pkt = encodeAvatarPickerRequest({
			agentId: session.agentId, sessionId: session.sessionId,
			queryId: d.queryId, name: d.query, seq,
		})
		trackReliable(session, seq, pkt)
		session.udpSocket.send(pkt, session.simPort, session.simIp)
		slog.info(session.ws, `→ AvatarPickerRequest "${d.query}" q=${d.queryId.slice(0, 8)}…`)
		return
	}
```

- [ ] **Step 4: Add the inbound dispatch**

After the OnlineNotification block (ends ~line 729), add:

```typescript
	if (type === `low:${LOW_AVATAR_PICKER_REPLY}`) {
		try {
			const r = decodeAvatarPickerReply(buf, dataOffset)
			const avatars = r.avatars.map(a => ({ id: a.id, name: `${a.firstName} ${a.lastName}`.trim() }))
			session.ws.send(JSON.stringify({ t: S.AVATAR_PICKER_REPLY, d: { queryId: r.queryId, avatars } }))
			slog.info(session.ws, `[Picker] ${avatars.length} result(s) q=${r.queryId.slice(0, 8)}…`)
		} catch (e) { slog.warn(session.ws, `AvatarPickerReply decode error: ${(e as Error).message}`) }
		return
	}
	if (type === `low:${LOW_CHANGE_USER_RIGHTS}`) {
		try {
			const r = decodeChangeUserRights(buf, dataOffset)
			for (const entry of r.rights) {
				session.ws.send(JSON.stringify({ t: S.FRIEND_RIGHTS_CHANGED, d: {
					agentId: r.agentId, relatedId: entry.agentRelated, rights: entry.relatedRights,
				} }))
			}
			slog.info(session.ws, `[Friends] rights changed agent=${r.agentId.slice(0, 8)}… ×${r.rights.length}`)
		} catch (e) { slog.warn(session.ws, `ChangeUserRights decode error: ${(e as Error).message}`) }
		return
	}
```

> NOTE: confirm `dataOffset` and `buf` are the variable names in scope at the inbound dispatch site (they are, per the OnlineNotification block at line 719-729). If the local names differ, match them.

- [ ] **Step 5: Type-check the server**

Run: `npx tsc --noEmit -p server/tsconfig.json` (if no server tsconfig, run `bunx tsc --noEmit server/handlers/lludp.ts` and ignore unrelated module-resolution noise — the goal is no errors in the new blocks).
Expected: no new type errors referencing the added code.

- [ ] **Step 6: Commit** (ask user first)

```bash
git add server/handlers/lludp.ts
git commit -m "feat(server): relay avatar-picker results + inbound friend-rights changes"
```

---

## Task 4: gridSocialStore — add/patch friends + rights bit helpers

**Files:**
- Modify: `src/stores/gridSocialStore.js`
- Test: `src/__tests__/stores/gridSocialStore.rights.test.js` (new)

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/stores/gridSocialStore.rights.test.js`:

```javascript
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import {
	useGridSocialStore, hasRight, setRight,
	RIGHT_ONLINE, RIGHT_MAP, RIGHT_MODIFY,
} from '@/stores/gridSocialStore'

beforeEach(() => setActivePinia(createPinia()))

describe('rights bit helpers', () => {
	it('hasRight reads a bit', () => {
		expect(hasRight(RIGHT_ONLINE | RIGHT_MAP, RIGHT_MAP)).toBe(true)
		expect(hasRight(RIGHT_ONLINE, RIGHT_MODIFY)).toBe(false)
	})
	it('setRight toggles a bit without disturbing others', () => {
		expect(setRight(RIGHT_ONLINE, RIGHT_MAP, true)).toBe(RIGHT_ONLINE | RIGHT_MAP)
		expect(setRight(RIGHT_ONLINE | RIGHT_MAP, RIGHT_MAP, false)).toBe(RIGHT_ONLINE)
	})
})

describe('addFriend', () => {
	it('inserts a new friend (lowercased id) and is idempotent', () => {
		const s = useGridSocialStore()
		s.addFriend('ABC-123', 'Bob Linden')
		s.addFriend('abc-123', 'Bob Linden')
		expect(s.friends.length).toBe(1)
		expect(s.friends[0]).toMatchObject({ id: 'abc-123', name: 'Bob Linden', rightsGiven: 0, rightsHas: 0 })
	})
})

describe('applyRightsChange / setRightsGivenLocal', () => {
	it('patches rightsGiven / rightsHas only where provided', () => {
		const s = useGridSocialStore()
		s.addFriend('x', 'X', 1, 2)
		s.applyRightsChange({ agentId: 'x', rightsGiven: 7 })
		expect(s.friendById('x')).toMatchObject({ rightsGiven: 7, rightsHas: 2 })
		s.applyRightsChange({ agentId: 'x', rightsHas: 4 })
		expect(s.friendById('x')).toMatchObject({ rightsGiven: 7, rightsHas: 4 })
	})
	it('setRightsGivenLocal sets rightsGiven optimistically', () => {
		const s = useGridSocialStore()
		s.addFriend('y', 'Y')
		s.setRightsGivenLocal('y', 3)
		expect(s.friendById('y').rightsGiven).toBe(3)
	})
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/__tests__/stores/gridSocialStore.rights.test.js`
Expected: FAIL — `hasRight is not a function` / `addFriend is not a function`.

- [ ] **Step 3: Implement the helpers + mutations**

In `src/stores/gridSocialStore.js`, after the `RIGHT_MODIFY` const (line 13), add the pure helpers:

```javascript
// Pure bit helpers for rights bitmasks (exported for the Contacts UI + tests).
export const hasRight = (mask, bit) => (Number(mask) & bit) !== 0
export const setRight = (mask, bit, on) => on ? (Number(mask) | bit) : (Number(mask) & ~bit)
```

Inside the store, after `setFriendStatus` (line 65), add:

```javascript
		/** Insert a friend if not already present (optimistic add on accept/accepted). */
		function addFriend(id, name = '', rightsGiven = 0, rightsHas = 0) {
			const key = lc(id)
			if (!key || friends.value.some(f => f.id === key)) return
			friends.value = [...friends.value, { id: key, name, rightsGiven, rightsHas, online: false }]
		}

		/** Patch one friend's rights bits (only fields that are defined). */
		function applyRightsChange({ agentId, rightsGiven, rightsHas } = {}) {
			const key = lc(agentId)
			friends.value = friends.value.map(f => {
				if (f.id !== key) return f
				const next = { ...f }
				if (rightsGiven !== undefined) next.rightsGiven = rightsGiven | 0
				if (rightsHas   !== undefined) next.rightsHas   = rightsHas | 0
				return next
			})
		}

		/** Optimistic local set of rights-I-grant, before the sim confirms via ChangeUserRights. */
		function setRightsGivenLocal(id, bitmask) {
			applyRightsChange({ agentId: id, rightsGiven: bitmask | 0 })
		}
```

Then add `addFriend, applyRightsChange, setRightsGivenLocal` to the store's `return { ... }` block (after `setFriendStatus`).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/__tests__/stores/gridSocialStore.rights.test.js`
Expected: PASS.

- [ ] **Step 5: Commit** (ask user first)

```bash
git add src/stores/gridSocialStore.js src/__tests__/stores/gridSocialStore.rights.test.js
git commit -m "feat(social): addFriend, rights patch/local-set, bit helpers"
```

---

## Task 5: notificationStore

**Files:**
- Create: `src/stores/notificationStore.js`
- Test: `src/__tests__/stores/notificationStore.test.js` (new)

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/stores/notificationStore.test.js`:

```javascript
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useNotificationStore } from '@/stores/notificationStore'

beforeEach(() => setActivePinia(createPinia()))

describe('notificationStore', () => {
	it('pushToast adds newest-first and dismissToast removes by id', () => {
		const s = useNotificationStore()
		const a = s.pushToast({ title: 'A' })
		const b = s.pushToast({ title: 'B' })
		expect(s.toasts.map(t => t.id)).toEqual([b, a])
		s.dismissToast(a)
		expect(s.toasts.map(t => t.id)).toEqual([b])
	})

	it('addItem + unreadCount + markRead + clearTab', () => {
		const s = useNotificationStore()
		const id = s.addItem({ tab: 'system', title: 'hi' })
		s.addItem({ tab: 'group', title: 'g' })
		expect(s.unreadCount('system')).toBe(1)
		expect(s.totalUnread).toBe(2)
		s.markRead(id)
		expect(s.unreadCount('system')).toBe(0)
		s.clearTab('group')
		expect(s.tabItems('group')).toEqual([])
	})

	it('notify links toast + item under a group; dismissGroup clears both', () => {
		const s = useNotificationStore()
		const { groupId, itemId, toastId } = s.notify({ tab: 'system', title: 'offer', sticky: true })
		expect(s.toasts.find(t => t.id === toastId)).toBeTruthy()
		expect(s.items.find(i => i.id === itemId)).toBeTruthy()
		s.dismissGroup(groupId)
		expect(s.toasts.length).toBe(0)
		expect(s.items.length).toBe(0)
	})

	it('notify with toast:false adds an item but no toast', () => {
		const s = useNotificationStore()
		const { toastId } = s.notify({ tab: 'system', title: 'x', toast: false })
		expect(toastId).toBe(null)
		expect(s.items.length).toBe(1)
		expect(s.toasts.length).toBe(0)
	})
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/__tests__/stores/notificationStore.test.js`
Expected: FAIL — cannot resolve `@/stores/notificationStore`.

- [ ] **Step 3: Implement the store**

Create `src/stores/notificationStore.js`:

```javascript
// src/stores/notificationStore.js — toast + persistent notification state.
// toasts[] render in ToastStack (right edge, auto-fade). items[] persist in NotificationsFloater,
// bucketed by tab. A "group" links a toast to its persistent item so actioning one clears both.
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const NOTIF_TABS = ['system', 'transactions', 'invitations', 'group']

export const useNotificationStore = defineStore('notifications', () => {
	const toasts = ref([]) // [{ id, groupId, kind, title, body, icon, actions, sticky, createdAt }]
	const items  = ref([]) // [{ id, groupId, tab, title, body, icon, actions, read, ts }]

	let _seq = 0
	const nextId = () => `n${++_seq}`

	function pushToast({ groupId = null, kind = 'info', title = '', body = '', icon = '', actions = [], sticky = false }) {
		const id = nextId()
		toasts.value = [{ id, groupId, kind, title, body, icon, actions, sticky, createdAt: Date.now() }, ...toasts.value]
		return id
	}
	function dismissToast(id) { toasts.value = toasts.value.filter(t => t.id !== id) }

	function addItem({ groupId = null, tab = 'system', title = '', body = '', icon = '', actions = [] }) {
		const id = nextId()
		items.value = [{ id, groupId, tab, title, body, icon, actions, read: false, ts: Date.now() }, ...items.value]
		return id
	}
	function removeItem(id) { items.value = items.value.filter(i => i.id !== id) }
	function markRead(id)   { items.value = items.value.map(i => i.id === id ? { ...i, read: true } : i) }
	function clearTab(tab)  { items.value = items.value.filter(i => i.tab !== tab) }

	/** Remove every toast + item sharing a groupId (used by offer Accept/Decline). */
	function dismissGroup(groupId) {
		if (!groupId) return
		toasts.value = toasts.value.filter(t => t.groupId !== groupId)
		items.value  = items.value.filter(i => i.groupId !== groupId)
	}

	/** Create a persistent item and (optionally) a linked toast. */
	function notify({ groupId = nextId(), tab = 'system', title = '', body = '', icon = '', actions = [], toast = true, sticky = false } = {}) {
		const itemId  = addItem({ groupId, tab, title, body, icon, actions })
		const toastId = toast ? pushToast({ groupId, kind: sticky ? 'offer' : 'info', title, body, icon, actions, sticky }) : null
		return { groupId, itemId, toastId }
	}

	const unreadCount = (tab) => items.value.filter(i => i.tab === tab && !i.read).length
	const tabItems    = (tab) => items.value.filter(i => i.tab === tab)
	const totalUnread = computed(() => items.value.filter(i => !i.read).length)

	return {
		toasts, items,
		pushToast, dismissToast, addItem, removeItem, markRead, clearTab, dismissGroup, notify,
		unreadCount, tabItems, totalUnread,
	}
})
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/__tests__/stores/notificationStore.test.js`
Expected: PASS.

- [ ] **Step 5: Commit** (ask user first)

```bash
git add src/stores/notificationStore.js src/__tests__/stores/notificationStore.test.js
git commit -m "feat(notifications): notificationStore (toasts + tabbed items + groups)"
```

---

## Task 6: useNotifications composable

**Files:**
- Create: `src/composables/useNotifications.js`

- [ ] **Step 1: Implement (thin, generic — no friend logic here to avoid a cycle with useSocial)**

Create `src/composables/useNotifications.js`:

```javascript
// src/composables/useNotifications.js — generic helpers over notificationStore.
// Friend-offer specific notifications live in useSocial (which owns respond/add), to avoid a
// circular dependency. This composable only offers reusable info/error notifications + store access.
import { useNotificationStore } from '@/stores/notificationStore'

export function useNotifications() {
	const store = useNotificationStore()

	function notifyInfo(title, body = '') {
		return store.notify({ tab: 'system', title, body, sticky: false })
	}
	function notifyError(title, body = '') {
		return store.notify({ tab: 'system', title, body, sticky: false, icon: 'error' })
	}

	return { store, notifyInfo, notifyError }
}
```

- [ ] **Step 2: Lint**

Run: `npx eslint src/composables/useNotifications.js`
Expected: no errors.

- [ ] **Step 3: Commit** (ask user first)

```bash
git add src/composables/useNotifications.js
git commit -m "feat(notifications): useNotifications helper composable"
```

---

## Task 7: useSocial — friendship offers, rights changes, avatar picker

**Files:**
- Modify: `src/composables/useSocial.js`

- [ ] **Step 1: Add imports + module state**

At the top of `src/composables/useSocial.js`, extend imports:

```javascript
import { useNotificationStore } from '@/stores/notificationStore'
import { useSessionStore } from '@/stores/sessionStore'
```

After `let nameWatcher = null` (line 12), add:

```javascript
// Pending avatar-picker queries: queryId -> resolve fn. Module-level so the singleton handler resolves them.
const pickerQueries = new Map()
```

- [ ] **Step 2: Add store handles inside `useSocial()`**

After `const social = useGridSocialStore()` (line 16), add:

```javascript
	const notif   = useNotificationStore()
	const session = useSessionStore()
```

- [ ] **Step 3: Add `findAvatars` + outbound offer toast**

Replace `offerFriendship` (lines 27-29) with a version that also toasts, and add `findAvatars`:

```javascript
	function offerFriendship(toAgentId, toAgentName, message) {
		if (!toAgentId) return
		emit(C.FRIEND_OFFER, { toAgentId, toAgentName, message })
		notif.notify({ tab: 'system', title: 'Friendship offered', body: `You offered friendship to ${toAgentName || toAgentId.slice(0, 8)}.` })
	}

	/** Add-Friend name search. Resolves to [{ id, name }] (empty on timeout). */
	function findAvatars(query) {
		return new Promise((resolve) => {
			const queryId = crypto.randomUUID()
			pickerQueries.set(queryId, resolve)
			emit(C.AVATAR_PICKER_REQ, { query, queryId })
			// WHY: never leave a hanging promise if the sim returns nothing.
			setTimeout(() => {
				if (pickerQueries.has(queryId)) { pickerQueries.delete(queryId); resolve([]) }
			}, 8000)
		})
	}
```

- [ ] **Step 4: Add the inbound handlers**

After `onParcelInfo` (line 51), add:

```javascript
	function onAvatarPickerReply(d) {
		const r = pickerQueries.get(d?.queryId)
		if (r) { pickerQueries.delete(d.queryId); r(d?.avatars || []) }
	}

	function onFriendRightsChanged(d) {
		const me = (session.agentId || '').toLowerCase()
		if ((d?.relatedId || '').toLowerCase() === me) {
			// The friend (d.agentId) changed what they grant me → my rightsHas.
			social.applyRightsChange({ agentId: d.agentId, rightsHas: d.rights })
		} else if ((d?.agentId || '').toLowerCase() === me) {
			// I changed what I grant d.relatedId → that friend's rightsGiven.
			social.applyRightsChange({ agentId: d.relatedId, rightsGiven: d.rights })
		}
	}

	// Friendship dialogs ride on ImprovedInstantMessage (S.IM_RECV). useInstantMessage ignores
	// non-zero dialogs, so we own 38/39/40 here.
	function onFriendshipIm(d) {
		const fromName = d?.fromAgentName || (d?.fromAgentId || '').slice(0, 8)
		if (d?.dialog === 38) {
			// Incoming offer — sticky toast + System item with Accept/Decline.
			const transactionId = d.imId
			const { groupId } = notif.notify({
				tab: 'system', sticky: true,
				title: `Friendship offer from ${fromName}`,
				body: d.message || 'Will you be my friend?',
				actions: [
					{ label: 'Accept', variant: 'primary', run: () => {
						respondFriendship(transactionId, true)
						social.addFriend(d.fromAgentId, fromName)
						notif.dismissGroup(groupId)
					} },
					{ label: 'Decline', variant: 'ghost', run: () => {
						respondFriendship(transactionId, false)
						notif.dismissGroup(groupId)
					} },
				],
			})
		} else if (d?.dialog === 39) {
			social.addFriend(d.fromAgentId, fromName)
			notif.notify({ tab: 'system', title: `${fromName} accepted your friendship offer.` })
		} else if (d?.dialog === 40) {
			notif.notify({ tab: 'system', title: `${fromName} declined your friendship offer.` })
		}
	}
```

> The `actions[].run` closures capture `groupId` returned by `notify` — valid because `notify` returns synchronously before any action can fire.

- [ ] **Step 5: Register the new listeners**

Inside the `onMounted` `if (!registered)` block (after `on(S.NAME_REPLY, onNameReply)`, line 60), add:

```javascript
				on(S.AVATAR_PICKER_REPLY,   onAvatarPickerReply)
				on(S.FRIEND_RIGHTS_CHANGED, onFriendRightsChanged)
				on(S.IM_RECV,               onFriendshipIm)
```

- [ ] **Step 6: Export `findAvatars`**

Add `findAvatars` to the `return { ... }` (line 74-77).

- [ ] **Step 7: Lint + smoke-run the social/store test suite**

Run: `npx eslint src/composables/useSocial.js`
Run: `npx vitest run src/__tests__/stores/`
Expected: lint clean; existing store tests still pass (no regression).

- [ ] **Step 8: Commit** (ask user first)

```bash
git add src/composables/useSocial.js
git commit -m "feat(social): incoming friend offers, rights-change apply, avatar-picker search"
```

---

## Task 8: ToastStack component

**Files:**
- Create: `src/components/ToastStack.vue`
- Modify: `src/views/WorldView.vue` (import + mount, NOT behind a `v-if`)

- [ ] **Step 1: Implement ToastStack**

Create `src/components/ToastStack.vue`:

```vue
<script setup>
import { onBeforeUnmount } from 'vue'
import { useNotificationStore } from '@/stores/notificationStore'

const notif = useNotificationStore()

// Per-toast fade timers. Non-sticky toasts auto-dismiss; hovering pauses.
const VISIBLE_MS = 6000
const timers = new Map()

function arm(id, sticky) {
	if (sticky || timers.has(id)) return
	timers.set(id, setTimeout(() => { notif.dismissToast(id); timers.delete(id) }, VISIBLE_MS))
}
function pause(id) { const t = timers.get(id); if (t) { clearTimeout(t); timers.delete(id) } }
function runAction(action) { try { action.run?.() } catch (e) { console.error('[toast action]', e) } }

onBeforeUnmount(() => { for (const t of timers.values()) clearTimeout(t); timers.clear() })
</script>

<template>
	<div class="fixed top-14 right-3 z-[200] flex flex-col gap-2 w-[20rem] max-w-[90vw] pointer-events-none">
		<div
			v-for="t in notif.toasts"
			:key="t.id"
			class="qs-panel pointer-events-auto rounded-lg border border-brd bg-card shadow-lg p-3 animate-[fadeIn_0.2s_ease]"
			:class="t.kind === 'error' ? 'border-red-500/50' : t.kind === 'offer' ? 'border-accent/60' : ''"
			@mouseenter="pause(t.id)"
			@mouseleave="arm(t.id, t.sticky)"
			@vue:mounted="arm(t.id, t.sticky)"
		>
			<div class="flex items-start gap-2">
				<div class="flex-1 min-w-0">
					<div class="text-xs font-semibold text-t1 truncate">{{ t.title }}</div>
					<div v-if="t.body" class="text-2xs text-tm mt-0.5 break-words">{{ t.body }}</div>
				</div>
				<button class="text-tm hover:text-t1 text-xs leading-none shrink-0" title="Dismiss" @click="notif.dismissToast(t.id)">✕</button>
			</div>
			<div v-if="t.actions?.length" class="flex gap-2 mt-2 justify-end">
				<button
					v-for="(a, i) in t.actions"
					:key="i"
					class="px-2 py-0.5 rounded text-2xs"
					:class="a.variant === 'primary' ? 'bg-accent text-white hover:opacity-80' : 'border border-brd text-t1 hover:bg-white/10'"
					@click="runAction(a)"
				>{{ a.label }}</button>
			</div>
		</div>
	</div>
</template>
```

> WHY `@vue:mounted="arm(...)"`: arms the fade timer once the toast element is in the DOM. (`@vue:mounted` is Vue 3's element lifecycle hook — supported in templates.)

- [ ] **Step 2: Mount in WorldView**

In `src/views/WorldView.vue`, add the import alongside the other floater imports (~line 19):

```javascript
import ToastStack			from '@/components/ToastStack.vue'
```

And mount it inside the floater container, after `<AvatarContextMenu />` (line 144) — it must NOT be wrapped in a `v-if`:

```html
					<ToastStack />
```

- [ ] **Step 3: Manual verification**

Run: `npm run dev` (+ `npm run dev:server` in a second terminal). In the browser devtools console:

```js
const s = window.__pinia ? null : null // (skip if no global)
```

Simpler: temporarily call from any mounted component, or use the Vue devtools to invoke `notificationStore.notify({ title: 'Test', body: 'hello' })` and `notify({ title: 'Offer', sticky: true, actions: [{label:'Accept',variant:'primary',run:()=>console.log('a')},{label:'Decline',run:()=>console.log('d')}] })`.
Expected: info toast appears top-right and fades after ~6s; hovering pauses the fade; sticky offer toast stays and its buttons log to console; ✕ dismisses.

- [ ] **Step 4: Lint + commit** (ask user first)

```bash
npx eslint src/components/ToastStack.vue
git add src/components/ToastStack.vue src/views/WorldView.vue
git commit -m "feat(notifications): ToastStack with auto-fade + actions"
```

---

## Task 9: NotificationsFloater + uiStore wiring + toolbar bell

**Files:**
- Create: `src/components/NotificationsFloater.vue`
- Modify: `src/stores/uiStore.js`, `src/views/WorldView.vue`, `src/components/BottomToolbar.vue`

- [ ] **Step 1: uiStore — show flag, toggle, registration**

In `src/stores/uiStore.js`:
- Near `const showMap = ref(false)` (line 35), add: `const showNotifications = ref(false)`
- Near `function toggleMap()` (line 87), add: `function toggleNotifications() { showNotifications.value = !showNotifications.value }`
- In `_FLOATER_CLOSE` (line 141), add an entry: `notifications: () => { showNotifications.value = false },`
- In the store `return { ... }`: add `showNotifications` (next to `showMap`, line 204) and `toggleNotifications` (next to `toggleMap`, line 211).

- [ ] **Step 2: Implement NotificationsFloater**

Create `src/components/NotificationsFloater.vue`:

```vue
<script setup>
import { ref, computed } from 'vue'
import FloaterWindow from '@/components/FloaterWindow.vue'
import { useUiStore } from '@/stores/uiStore'
import { useNotificationStore } from '@/stores/notificationStore'

const ui    = useUiStore()
const notif = useNotificationStore()

const TABS = [
	{ id: 'system',       label: 'System' },
	{ id: 'transactions', label: 'Transactions' },
	{ id: 'invitations',  label: 'Invitations' },
	{ id: 'group',        label: 'Group' },
]
const activeTab = ref('system')
const items = computed(() => notif.tabItems(activeTab.value))

function onItemClick(it) { if (!it.read) notif.markRead(it.id) }
function runAction(it, a) { try { a.run?.() } catch (e) { console.error('[notif action]', e) } finally { /* group dismissal handled by the action */ } }
</script>

<template>
	<FloaterWindow
		id="notifications"
		title="Notifications"
		:wrap-style="{ width: '24vw', height: '40vh', resize: 'both' }"
		:default-pos="{ right: '1%', top: '7%' }"
		@close="ui.toggleNotifications()"
	>
		<div class="flex flex-col flex-1 min-h-0">
			<!-- Tab strip with counts -->
			<nav class="flex border-b border-brd shrink-0 text-xs">
				<button
					v-for="t in TABS"
					:key="t.id"
					class="px-2.5 py-1.5 border-b-2 -mb-px"
					:class="activeTab === t.id ? 'border-accent text-t1' : 'border-transparent text-tm hover:text-t1'"
					@click="activeTab = t.id"
				>
					{{ t.label }} <span class="text-tm">({{ notif.unreadCount(t.id) }})</span>
				</button>
			</nav>

			<!-- System tab: live list -->
			<div v-if="activeTab === 'system'" class="flex-1 overflow-y-auto min-h-0">
				<div v-if="!items.length" class="h-full flex items-center justify-center text-tm text-xs italic select-none">
					No notifications.
				</div>
				<div
					v-for="it in items"
					:key="it.id"
					class="px-2.5 py-2 border-b border-brd/60 cursor-default"
					:class="it.read ? 'opacity-60' : 'bg-white/5'"
					@click="onItemClick(it)"
				>
					<div class="text-xs text-t1 font-medium break-words">{{ it.title }}</div>
					<div v-if="it.body" class="text-2xs text-tm mt-0.5 break-words">{{ it.body }}</div>
					<div v-if="it.actions?.length" class="flex gap-2 mt-1.5">
						<button
							v-for="(a, i) in it.actions"
							:key="i"
							class="px-2 py-0.5 rounded text-2xs"
							:class="a.variant === 'primary' ? 'bg-accent text-white hover:opacity-80' : 'border border-brd text-t1 hover:bg-white/10'"
							@click.stop="runAction(it, a)"
						>{{ a.label }}</button>
					</div>
				</div>
			</div>

			<!-- Placeholder tabs -->
			<div v-else class="flex-1 flex items-center justify-center text-tm text-xs italic select-none">
				No {{ activeTab }} notifications yet.
			</div>

			<!-- Footer -->
			<div v-if="activeTab === 'system' && items.length" class="px-2 py-1.5 border-t border-brd shrink-0 flex justify-end">
				<button class="px-2 py-0.5 text-2xs rounded border border-brd text-t1 hover:bg-white/10" @click="notif.clearTab('system')">Clear all</button>
			</div>
		</div>
	</FloaterWindow>
</template>
```

> Confirm the `FloaterWindow` props `wrap-style`/`default-pos` match its API (they do per `ConversationsFloater.vue:163-164`). If `FloaterWindow` expects different prop names, mirror `ConversationsFloater`.

- [ ] **Step 3: Mount in WorldView**

In `src/views/WorldView.vue` add the import (~line 33, by `SettingsFloater`):

```javascript
import NotificationsFloater	from '@/components/NotificationsFloater.vue'
```

And mount it next to the other `v-if` floaters (after `<SettingsFloater v-if="ui.showSettings" />`, line 140):

```html
					<NotificationsFloater	v-if="ui.showNotifications" />
```

- [ ] **Step 4: Toolbar bell button**

Open `src/components/BottomToolbar.vue`, locate the existing Map toggle button (search for `toggleMap`). Mirror its markup to add a bell button bound to `ui.toggleNotifications()`, with an unread badge. Use the store:

In `<script setup>` of `BottomToolbar.vue`, add (if not already importing the notification store):

```javascript
import { useNotificationStore } from '@/stores/notificationStore'
const notif = useNotificationStore()
```

Add a button mirroring the Map button's classes, e.g.:

```html
<button class="<same classes as the Map button>" title="Notifications" @click="ui.toggleNotifications()">
	<span class="relative">
		🔔
		<span v-if="notif.totalUnread" class="absolute -top-1 -right-2 bg-red-600 text-white rounded-full text-[0.6rem] leading-none px-1 py-0.5 min-w-[1rem] text-center">{{ notif.totalUnread }}</span>
	</span>
</button>
```

> Match the surrounding toolbar button styling exactly (copy the Map button's `class` attribute). The emoji bell can be swapped for a lucide icon (`BellIcon` from `@lucide/vue`) if the toolbar uses icon components — follow whichever the file already does.

- [ ] **Step 5: Manual verification**

Run the app. Click the bell → NotificationsFloater opens with 4 tabs, each showing `(0)`. Trigger a notify (devtools/Vue devtools). System tab lists it; badge on the bell shows the unread count; clicking an item marks it read (dims, badge decrements); "Clear all" empties the System tab; other tabs show placeholder text. Floater drags, focuses, and closes via its ✕ (FloaterWindow behavior).

- [ ] **Step 6: Lint + commit** (ask user first)

```bash
npx eslint src/components/NotificationsFloater.vue src/components/BottomToolbar.vue src/stores/uiStore.js
git add src/components/NotificationsFloater.vue src/stores/uiStore.js src/views/WorldView.vue src/components/BottomToolbar.vue
git commit -m "feat(notifications): tabbed NotificationsFloater + toolbar bell"
```

---

## Task 10: Contacts tab — Firestorm table + 7-button bar + Add picker

**Files:**
- Modify: `src/components/ConversationsFloater.vue`

This rebuilds the Contacts `<template v-if="activeTab === 'contacts'">` block (lines 201-234) and adds supporting script. Other tabs (Nearby/IM) are unchanged.

- [ ] **Step 1: Extend the `<script setup>`**

In `ConversationsFloater.vue`, update the social imports + composable use (lines 7-17):

```javascript
import { useGridSocialStore, hasRight, setRight, RIGHT_ONLINE, RIGHT_MAP, RIGHT_MODIFY } from '@/stores/gridSocialStore'
import { useSocial } from '@/composables/useSocial'
```

```javascript
const { removeFriend, setFriendRights, offerFriendship, findAvatars } = useSocial()
```

After `confirmRemove` (line 45), add the selection state, rights toggle, action handlers, and the Add-picker logic:

```javascript
// ── Contacts: selection + rights + actions ────────────────────────────────
const selectedId = ref(null)
const selectedFriend = computed(() => social.friendById(selectedId.value))

function selectFriend(f) { selectedId.value = (selectedId.value === f.id) ? null : f.id }

// Toggle one of MY granted rights (online/map/modify) on a friend, then send to the sim.
function toggleRight(f, bit) {
	const next = setRight(f.rightsGiven, bit, !hasRight(f.rightsGiven, bit))
	social.setRightsGivenLocal(f.id, next) // optimistic; reconciled by S.FRIEND_RIGHTS_CHANGED
	setFriendRights(f.id, next)
}

// Action-bar enablement.
const canIM      = computed(() => !!selectedFriend.value)
const canProfile = computed(() => !!selectedFriend.value)
const canRemove  = computed(() => !!selectedFriend.value)
// Map/Teleport need the friend to have granted ME map rights and be online.
const canMap     = computed(() => !!selectedFriend.value && selectedFriend.value.online && hasRight(selectedFriend.value.rightsHas, RIGHT_MAP))
const canTeleport= computed(() => !!selectedFriend.value && selectedFriend.value.online)

function actIM()       { const f = selectedFriend.value; if (f) openIM(f) }
function actProfile()  { const f = selectedFriend.value; if (f) openProfile(f.id) }
function actRemove()   { const f = selectedFriend.value; if (f) confirmRemove(f) }
function actMap()      { const f = selectedFriend.value; if (f && canMap.value) { ui.profileTargetId = f.id; ui.showMap = true } }
function actTeleport() {
	// WHY: offer-teleport to a friend rides on the IM channel (dialog 22). No dedicated path yet,
	// so reuse offerFriendship's sibling once it exists. For now open an IM as the closest action.
	const f = selectedFriend.value; if (f && canTeleport.value) openIM(f)
}

// ── Add-Friend picker ──────────────────────────────────────────────────────
const showAdd     = ref(false)
const addQuery    = ref('')
const addResults  = ref([])
const addBusy     = ref(false)
function openAdd() { showAdd.value = true; addQuery.value = ''; addResults.value = [] }
async function runAddSearch() {
	const q = addQuery.value.trim()
	if (q.length < 2) return
	addBusy.value = true
	try { addResults.value = await findAvatars(q) }
	finally { addBusy.value = false }
}
function addFriendFromResult(r) {
	offerFriendship(r.id, r.name, 'Will you be my friend?')
	showAdd.value = false
}
```

> NOTE: `actTeleport`/`actMap` are intentionally minimal (the spec flagged these). `actMap` sets `ui.showMap` and a target id; if `MapFloater` doesn't yet read `ui.profileTargetId` for centering, that's a follow-up — the button still opens the map. Keep the gating (`canMap`/`canTeleport`) so they're disabled when not applicable.

- [ ] **Step 2: Replace the Contacts template block**

Replace lines 201-234 (the entire `<template v-if="activeTab === 'contacts'"> … </template>`) with:

```html
				<!-- Contacts (Firestorm-style rights table) ─────────── -->
				<template v-if="activeTab === 'contacts'">
					<div class="px-2 py-1.5 border-b border-brd shrink-0 flex items-center gap-2">
						<input
							v-model="contactSearch"
							type="text"
							placeholder="Filter friends"
							class="flex-1 min-w-0 bg-card2 border border-brd rounded text-t1 placeholder-tm px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-accent"
						/>
						<span class="text-2xs text-tm shrink-0">{{ social.onlineCount }}/{{ social.friendCount }} online</span>
					</div>

					<div v-if="social.friendCount === 0" class="flex-1 flex items-center justify-center text-gray-200 text-xs italic select-none">
						No friends on this account
					</div>

					<div v-else class="flex-1 overflow-y-auto min-h-0">
						<!-- Column header: name | (you grant: online,map,edit) | (they grant: map,edit) -->
						<div class="flex items-center gap-1 px-2 py-1 text-2xs text-tm sticky top-0 bg-card border-b border-brd z-10 select-none">
							<span class="w-2 shrink-0"></span>
							<span class="flex-1 min-w-0">Name</span>
							<span class="w-5 text-center shrink-0" title="Friend can see when you're online">👁</span>
							<span class="w-5 text-center shrink-0" title="Friend can locate you on the map">🗺</span>
							<span class="w-5 text-center shrink-0" title="Friend can edit, delete or take your objects">✎</span>
							<span class="w-1 shrink-0"></span>
							<span class="w-5 text-center shrink-0 opacity-60" title="You can locate them on the map">🗺</span>
							<span class="w-5 text-center shrink-0 opacity-60" title="You can edit this friend's objects">✎</span>
						</div>

						<div
							v-for="f in sortedFriends"
							:key="f.id"
							class="flex items-center gap-1 px-2 py-1 cursor-default border-b border-brd/40"
							:class="selectedId === f.id ? 'bg-accent/20' : 'hover:bg-white/5'"
							@click="selectFriend(f)"
							@dblclick="openIM(f)"
						>
							<span class="w-2 h-2 rounded-full shrink-0" :class="f.online ? 'bg-green-500' : 'bg-gray-500/50'" :title="f.online ? 'Online' : 'Offline'" />
							<span class="flex-1 min-w-0 truncate text-xs" :class="f.online ? 'text-t1' : 'text-tm'">{{ friendLabel(f) }}</span>

							<!-- Editable: rights I grant -->
							<input type="checkbox" class="w-5 accent-accent shrink-0 cursor-pointer" title="Friend can see when you're online"
								:checked="hasRight(f.rightsGiven, RIGHT_ONLINE)" @click.stop="toggleRight(f, RIGHT_ONLINE)" />
							<input type="checkbox" class="w-5 accent-accent shrink-0 cursor-pointer" title="Friend can locate you on the map"
								:checked="hasRight(f.rightsGiven, RIGHT_MAP)" @click.stop="toggleRight(f, RIGHT_MAP)" />
							<input type="checkbox" class="w-5 accent-accent shrink-0 cursor-pointer" title="Friend can edit, delete or take your objects"
								:checked="hasRight(f.rightsGiven, RIGHT_MODIFY)" @click.stop="toggleRight(f, RIGHT_MODIFY)" />
							<span class="w-1 shrink-0"></span>
							<!-- Read-only: rights they grant me -->
							<input type="checkbox" disabled class="w-5 shrink-0 opacity-60" title="You can locate them on the map"
								:checked="hasRight(f.rightsHas, RIGHT_MAP)" @click.stop />
							<input type="checkbox" disabled class="w-5 shrink-0 opacity-60" title="You can edit this friend's objects"
								:checked="hasRight(f.rightsHas, RIGHT_MODIFY)" @click.stop />
						</div>
					</div>

					<!-- 7-button action bar (Firestorm parity) -->
					<div class="px-2 py-1.5 border-t border-brd shrink-0 flex flex-wrap gap-1">
						<button class="qs-btn-mini" :disabled="!canIM"       title="Send IM (Call disabled until voice)" @click="actIM">IM</button>
						<button class="qs-btn-mini" :disabled="!canProfile"  title="View profile" @click="actProfile">Profile</button>
						<button class="qs-btn-mini" :disabled="!canTeleport" title="Offer teleport" @click="actTeleport">Teleport</button>
						<button class="qs-btn-mini" :disabled="!canMap"      title="Show on map" @click="actMap">Map</button>
						<button class="qs-btn-mini" disabled                 title="Pay — not yet available">Pay</button>
						<button class="qs-btn-mini" :disabled="!canRemove"   title="Remove friend" @click="actRemove">Remove</button>
						<button class="qs-btn-mini" title="Add a friend by name" @click="openAdd">Add</button>
					</div>

					<!-- Add-Friend picker (inline) -->
					<div v-if="showAdd" class="px-2 py-2 border-t border-brd shrink-0 bg-card2">
						<div class="flex gap-1.5">
							<input v-model="addQuery" type="text" placeholder="Search by name…" maxlength="63"
								class="flex-1 min-w-0 bg-card border border-brd rounded text-t1 placeholder-tm px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-accent"
								@keyup.enter="runAddSearch" />
							<button class="qs-btn-mini" :disabled="addBusy || addQuery.trim().length < 2" @click="runAddSearch">{{ addBusy ? '…' : 'Search' }}</button>
							<button class="qs-btn-mini" @click="showAdd = false">Cancel</button>
						</div>
						<div v-if="addResults.length" class="mt-1.5 max-h-32 overflow-y-auto">
							<button v-for="r in addResults" :key="r.id"
								class="block w-full text-left px-2 py-1 text-xs text-t1 hover:bg-white/10 rounded"
								@click="addFriendFromResult(r)">{{ r.name }}</button>
						</div>
						<div v-else-if="!addBusy && addQuery.trim().length >= 2" class="mt-1.5 text-2xs text-tm italic">No matches.</div>
					</div>
				</template>
```

- [ ] **Step 3: Add the `qs-btn-mini` helper class**

The action bar uses a shared mini-button. Add to `src/index.css` under `@layer components` (search the file for the existing `qs-btn` definitions and place it nearby):

```css
	.qs-btn-mini {
		@apply px-2 py-0.5 text-2xs rounded border border-brd text-t1 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent;
	}
```

> If `@apply` with these tokens fails (CSS-var color quirk noted in CLAUDE.md), fall back to writing the rules out longhand. Verify `disabled:opacity-40` renders greyed.

- [ ] **Step 4: Manual verification**

Run the app, log into a grid with friends. Contacts tab shows the table: online dot, name, 3 editable checkboxes (reflecting `rightsGiven`), a gap, 2 disabled checkboxes (reflecting `rightsHas`). Clicking a row selects it (highlight) and enables IM/Profile/Remove; Map enabled only when the friend is online AND has granted you map rights; Pay always disabled. Toggling an editable checkbox sends `FRIEND_RIGHTS` (watch the server log for `→ ChangeUserRights … rights=N`) and stays toggled. `Add` opens the picker; typing a name + Search returns results (server log `→ AvatarPickerRequest`); clicking a result sends an offer (`→ OfferFriendship`) and shows the outgoing toast.

- [ ] **Step 5: Lint + commit** (ask user first)

```bash
npx eslint src/components/ConversationsFloater.vue
git add src/components/ConversationsFloater.vue src/index.css
git commit -m "feat(contacts): Firestorm-style rights table, 7-button bar, add-by-name picker"
```

---

## Task 11: Right-click avatar menu — Add Friend

**Files:**
- Modify: `src/components/AvatarContextMenu.vue`

- [ ] **Step 1: Wire the action**

In `AvatarContextMenu.vue` `<script setup>`, add (if not present):

```javascript
import { useGridSocialStore } from '@/stores/gridSocialStore'
import { useSocial } from '@/composables/useSocial'
const social = useGridSocialStore()
const { offerFriendship } = useSocial()

function addFriend() {
	if (menu.value) offerFriendship(menu.value.agentId, menu.value.name, 'Will you be my friend?')
	ui.closeAvatarMenu()
}
```

(Use the existing `menu`/`ui` references already in the file — match their names.)

- [ ] **Step 2: Add the menu item**

In the template, alongside the existing "Send IM…" / "View Profile" items, add (shown only for non-friends):

```html
<button
	v-if="!social.isFriend(menu.agentId)"
	class="<same classes as the other menu buttons>"
	@click="addFriend"
>Add Friend</button>
```

> Copy the exact `class` from a sibling enabled menu button so styling matches.

- [ ] **Step 3: Manual verification**

Run the app. Right-click an avatar in-world that is NOT already a friend → menu shows "Add Friend"; clicking it sends an offer (server log `→ OfferFriendship`) + outgoing toast, and closes the menu. Right-click an existing friend → "Add Friend" is hidden.

- [ ] **Step 4: Lint + commit** (ask user first)

```bash
npx eslint src/components/AvatarContextMenu.vue
git add src/components/AvatarContextMenu.vue
git commit -m "feat(contacts): Add Friend from right-click avatar menu"
```

---

## Final verification

- [ ] **Run the full unit suite:** `npx vitest run`
  Expected: all green, including the three new test files. (Note: `server/__tests__/*` use `bun:test` and are excluded from vitest — run those with `bun test` if touched; this plan adds only vitest `tests/server/` codec tests.)
- [ ] **Lint the whole tree:** `npm run lint`
  Expected: no errors.
- [ ] **Live smoke test** against a grid with at least one friend:
  - Incoming offer → toast with Accept/Decline + System-tab item; Accept adds the friend and clears both; Decline clears both.
  - Outgoing offer via Add-by-name and via right-click → offer sent + toast.
  - Rights checkbox toggle → reflected, survives, and (if the sim echoes `ChangeUserRights`) re-confirmed.
  - 7-button bar enablement matches state; Pay/Call disabled.
- [ ] Update `docs/CONTEXT.md` / relevant memory if the session surfaced anything non-obvious (optional).

---

## Self-Review notes (author)

- **Spec coverage:** 5 checkboxes (Task 10 §2), 7 buttons (Task 10 §2), add-by-name (Tasks 2/3/7/10), right-click add (Task 11), receive/accept offers (Task 7 + ToastStack Task 8 + Floater Task 9), toasts right-edge fade (Task 8), Notifications floater 4 tabs (Task 9), server rights inbound + picker (Tasks 2/3). All mapped.
- **Type consistency:** `notify()` returns `{ groupId, itemId, toastId }`; actions use `dismissGroup(groupId)`. `hasRight`/`setRight` signatures identical across store + Contacts. `applyRightsChange({ agentId, rightsGiven?, rightsHas? })` matches both the server relay (`{ agentId, relatedId, rights }` → resolved in `onFriendRightsChanged`) and optimistic local set.
- **Flagged-but-intentional minimal scope:** `actMap`/`actTeleport` (Task 10) open existing surfaces rather than implementing teleport-offer/map-centering — consistent with the spec's "reuse existing path if present" note. Pay/Call disabled per locked decision.
