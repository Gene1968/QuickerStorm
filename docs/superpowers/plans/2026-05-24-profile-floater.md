# Profile Floater Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Profile floater accessible via Avatar → Profile… that shows self (bio editable) or another user (read-only except Notes) with horizontal tabs.

**Architecture:** New `ProfileFloater.vue` follows the established floater pattern (mounted in `App.vue`, controlled by `uiStore` boolean + target ID). Two live tabs — Profile and Notes — three disabled stubs. Bio persisted in `avatarStore`; Notes in `localStorage` keyed by UUID.

**Tech Stack:** Vue 3 `<script setup>`, Pinia (uiStore + avatarStore), Tailwind CSS tokens, Lucide icons, Vitest for store tests.

**Spec:** `docs/superpowers/specs/2026-05-24-profile-floater-design.md`

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `src/stores/uiStore.js` | Add `showProfile`, `profileTargetId`, `openProfile()`, `toggleProfile()` |
| Modify | `src/stores/avatarStore.js` | Add `bio` state + `setBio()` action; include in snapshot/apply |
| Create | `src/components/ProfileFloater.vue` | Full floater component |
| Modify | `src/App.vue` | Import + mount `<ProfileFloater />` |
| Modify | `src/components/MenuBar.vue` | Wire Avatar → Profile… to `ui.openProfile()` |
| Create | `src/__tests__/stores/uiStore.test.js` | Store unit tests for profile state |
| Create | `src/__tests__/stores/avatarStore.bio.test.js` | Store unit tests for bio field |

---

## Task 1: uiStore — add profile state

**Files:**
- Modify: `src/stores/uiStore.js`
- Create: `src/__tests__/stores/uiStore.test.js`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/stores/uiStore.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useUiStore } from '@/stores/uiStore'

beforeEach(() => setActivePinia(createPinia()))

describe('uiStore profile', () => {
	it('showProfile defaults to false', () => {
		const store = useUiStore()
		expect(store.showProfile).toBe(false)
	})

	it('profileTargetId defaults to null', () => {
		const store = useUiStore()
		expect(store.profileTargetId).toBe(null)
	})

	it('openProfile() sets showProfile=true and targetId=null', () => {
		const store = useUiStore()
		store.openProfile()
		expect(store.showProfile).toBe(true)
		expect(store.profileTargetId).toBe(null)
	})

	it('openProfile(id) sets targetId to given UUID', () => {
		const store = useUiStore()
		store.openProfile('abc-123')
		expect(store.showProfile).toBe(true)
		expect(store.profileTargetId).toBe('abc-123')
	})

	it('toggleProfile toggles showProfile', () => {
		const store = useUiStore()
		store.toggleProfile()
		expect(store.showProfile).toBe(true)
		store.toggleProfile()
		expect(store.showProfile).toBe(false)
	})
})
```

- [ ] **Step 2: Run tests — expect failures**

```
npx vitest run src/__tests__/stores/uiStore.test.js
```

Expected: 5 failures — `showProfile is not a function` / property undefined.

- [ ] **Step 3: Add state to uiStore.js**

In `src/stores/uiStore.js`, after line 22 (the `showAO` line):

```js
	const showProfile       = ref(false)
	const profileTargetId   = ref(null)   // null = self; UUID string = other user
```

- [ ] **Step 4: Add actions to uiStore.js**

After line 41 (the `toggleAO` line), add:

```js
	function openProfile(id = null)  { profileTargetId.value = id; showProfile.value = true }
	function toggleProfile()         { showProfile.value = !showProfile.value }
```

- [ ] **Step 5: Expose in return block**

In the `return { … }` block (starts at line 53):

Add `showProfile, profileTargetId,` after `showAO,` on line 58.

Add `openProfile, toggleProfile,` after `toggleAO,` on line 63.

The return block should read:

```js
	return {
		mode, showAvatarList, showMinimap, showChat,
		showInventory, showMap, showSettings, showDebug,
		showPreferences, showQuickPrefs,
		showVoiceControls, showMoveControls, showCameraControls,
		showAppearance, showSearch, showSnapshot, showAO,
		showProfile, profileTargetId,
		toggleMode, toggleAvatarList, toggleMinimap, toggleChat,
		toggleInventory, toggleMap, toggleSettings, toggleDebug,
		togglePreferences, openPreferences, toggleQuickPrefs,
		toggleVoiceControls, toggleMoveControls, toggleCameraControls,
		toggleAppearance, toggleSearch, toggleSnapshot, toggleAO,
		openProfile, toggleProfile,
		cameraPos, setCameraPos,
		cameraYaw, setCameraYaw,
	}
```

- [ ] **Step 6: Run tests — expect all pass**

```
npx vitest run src/__tests__/stores/uiStore.test.js
```

Expected: 5 passing.

- [ ] **Step 7: Commit**

```
git add src/stores/uiStore.js src/__tests__/stores/uiStore.test.js
git commit -m "feat(ui): add profile floater state to uiStore"
```

---

## Task 2: avatarStore — add bio field

**Files:**
- Modify: `src/stores/avatarStore.js`
- Create: `src/__tests__/stores/avatarStore.bio.test.js`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/stores/avatarStore.bio.test.js`:

```js
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// Mock IndexedDB composable — not available in test environment
vi.mock('@/composables/useIndexedDB.js', () => ({
	useIndexedDB: () => ({
		get: vi.fn().mockResolvedValue(null),
		set: vi.fn().mockResolvedValue(undefined),
	}),
}))

import { useAvatarStore } from '@/stores/avatarStore'

beforeEach(() => setActivePinia(createPinia()))

describe('avatarStore bio', () => {
	it('bio defaults to empty string', () => {
		const store = useAvatarStore()
		expect(store.bio).toBe('')
	})

	it('setBio updates bio value', async () => {
		const store = useAvatarStore()
		await store.setBio('Hello world')
		expect(store.bio).toBe('Hello world')
	})

	it('setBio trims leading/trailing whitespace', async () => {
		const store = useAvatarStore()
		await store.setBio('  hello  ')
		expect(store.bio).toBe('hello')
	})

	it('setBio with null/undefined sets empty string', async () => {
		const store = useAvatarStore()
		await store.setBio(null)
		expect(store.bio).toBe('')
	})
})
```

- [ ] **Step 2: Run tests — expect failures**

```
npx vitest run src/__tests__/stores/avatarStore.bio.test.js
```

Expected: 4 failures — `bio` undefined, `setBio` not a function.

- [ ] **Step 3: Add bio state**

In `src/stores/avatarStore.js`, after line 43 (`const googleAccountIndex = ref(1) ...`):

```js
	const bio = ref('')   // About / profile bio text
```

- [ ] **Step 4: Add bio to _snapshot()**

In `_snapshot()` (around line 59–80), add `bio: bio.value,` inside the returned object, after the `isSetupDone` line:

```js
	function _snapshot() {
		return {
			avatarUrl:    avatarUrl.value,
			color:        color.value,
			skinTone:     skinTone.value,
			hairColor:    hairColor.value,
			hairStyle:    hairStyle.value,
			displayName:  displayName.value,
			title:        title.value,
			initials:     initials.value,
			status:       status.value,
			statusEmoji:   statusEmoji.value,
			statusMessage: statusMessage.value,
			slackId:            slackId.value,
			avaEmail:           avaEmail.value,
			slackUserToken:     slackUserToken.value,
			slackTeamId:        slackTeamId.value,
			authUserId:         authUserId.value,
			googleAccountIndex: googleAccountIndex.value,
			isSetupDone:        isSetupDone.value,
			bio:                bio.value,
		}
	}
```

- [ ] **Step 5: Add bio to _apply()**

In `_apply(saved)` (around line 82–105), add after the `isSetupDone.value` line:

```js
		bio.value = saved.bio ?? ''
```

- [ ] **Step 6: Add setBio action**

After the `setSlackUserToken` function (around line 190), add:

```js
	async function setBio(text) {
		bio.value = (text || '').trim()
		await save()
	}
```

- [ ] **Step 7: Expose in return block**

In the `return { … }` block (line 265+), add `bio, setBio,` — place after `avatarInitials,`:

```js
		avatarInitials,
		statusColor,
		bio,
		load,
		save,
		completeSetup,
		googleAccountIndex,
		setGoogleAccountIndex,
		setStatus,
		setSlackFromSync,
		setSlackCustom,
		setAvatarUrl,
		setSlackIdentity,
		setSlackUserToken,
		setBio,
		fromAuthUser,
```

- [ ] **Step 8: Run tests — expect all pass**

```
npx vitest run src/__tests__/stores/avatarStore.bio.test.js
```

Expected: 4 passing.

- [ ] **Step 9: Commit**

```
git add src/stores/avatarStore.js src/__tests__/stores/avatarStore.bio.test.js
git commit -m "feat(avatar): add bio field to avatarStore"
```

---

## Task 3: Create ProfileFloater.vue

**Files:**
- Create: `src/components/ProfileFloater.vue`

- [ ] **Step 1: Create the file**

Create `src/components/ProfileFloater.vue` with the full content below:

```vue
<script setup>
/**
 * ProfileFloater — Firestorm-style profile dialog.
 *
 * Self mode  (profileTargetId === null):
 *   bio textarea is editable; Save/Discard appear when dirty.
 *   No online indicator.
 *
 * Other mode (profileTargetId = UUID string):
 *   All fields read-only except Notes tab.
 *   Bold Online/Offline text shown next to name.
 *   Disabled action buttons shown at bottom.
 *
 * Controlled by: uiStore.showProfile + uiStore.profileTargetId
 * Mounted in: App.vue
 */
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useUiStore }       from '@/stores/uiStore.js'
import { useAvatarStore }   from '@/stores/avatarStore.js'
import { usePresenceStore } from '@/stores/presenceStore.js'
import { X as XIcon }       from '@lucide/vue'

const ui       = useUiStore()
const avatar   = useAvatarStore()
const presence = usePresenceStore()

// ── Computed ─────────────────────────────────────────────────────────────────
const isSelf = computed(() => ui.profileTargetId === null)

/** Display name shown in header */
const displayName = computed(() =>
	isSelf.value ? avatar.displayName : '(Other User)'
)

/** UUID shown in Key field */
const profileUUID = computed(() =>
	isSelf.value
		? (avatar.authUserId ?? '—')
		: (ui.profileTargetId ?? '—')
)

/**
 * Online status for other-user indicator.
 * Looks up profileTargetId in presenceStore.users.
 * Defaults to 'offline' if user not found (Phase 1: always null target).
 */
const onlineStatus = computed(() => {
	if (isSelf.value) return null
	const user = presence.users.find(u => u.id === ui.profileTargetId)
	return user?.status ?? 'offline'
})

// ── Tabs ─────────────────────────────────────────────────────────────────────
const TABS = [
	{ id: 'profile',    label: 'Profile',   soon: false },
	{ id: 'interests',  label: 'Interests', soon: true  },
	{ id: 'picks',      label: 'Picks',     soon: true  },
	{ id: 'first_life', label: '1st Life',  soon: true  },
	{ id: 'notes',      label: 'Notes',     soon: false },
]

const activeTab = ref('profile')

function selectTab(tab) {
	if (tab.soon) return
	activeTab.value = tab.id
}

// ── Bio editing (self only) ───────────────────────────────────────────────────
const bioEdit = ref('')
const bioDirty = computed(() => bioEdit.value !== avatar.bio)

// Reset edit buffer and go back to Profile tab whenever the floater opens
watch(() => ui.showProfile, (open) => {
	if (open) {
		bioEdit.value = avatar.bio
		activeTab.value = 'profile'
	}
}, { immediate: true })

async function saveBio() {
	await avatar.setBio(bioEdit.value)
}

function discardBio() {
	bioEdit.value = avatar.bio
}

// ── Notes (localStorage, per-UUID) ───────────────────────────────────────────
const notes = ref('')

function notesKey() {
	// WHY: Notes are private per viewer, keyed by UUID of the profile being viewed.
	// Self: keyed by own authUserId; Other: keyed by profileTargetId.
	const id = isSelf.value
		? (avatar.authUserId ?? 'self')
		: ui.profileTargetId
	return `ava_profile_notes_${id}`
}

// Reload notes from localStorage whenever the floater opens or target changes
watch(
	[() => ui.showProfile, () => ui.profileTargetId],
	([open]) => {
		if (open) notes.value = localStorage.getItem(notesKey()) ?? ''
	},
	{ immediate: true }
)

function saveNotes() {
	try { localStorage.setItem(notesKey(), notes.value) } catch { /* ignore: private-mode */ }
}

// ── Close ─────────────────────────────────────────────────────────────────────
function close() { ui.showProfile = false }

function onKey(e) { if (e.key === 'Escape') close() }

onMounted(()    => window.addEventListener('keydown', onKey))
onUnmounted(()  => window.removeEventListener('keydown', onKey))
</script>

<template>
	<!-- Backdrop: click outside closes floater -->
	<div class="fixed inset-0 z-40" @click.self="close" />

	<!-- Floater panel -->
	<div
		class="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
		       w-[30rem] h-[34rem] flex flex-col
		       bg-card border border-brd rounded-lg shadow-2xl overflow-hidden"
	>
		<!-- Header -->
		<div class="flex items-center justify-between px-4 py-2 border-b border-brd shrink-0">
			<span class="text-sm font-semibold text-t1">Profile</span>
			<button
				@click="close"
				class="p-1 rounded text-t1/60 hover:text-t1 hover:bg-white/10 transition-colors"
				aria-label="Close"
			>
				<XIcon :size="14" />
			</button>
		</div>

		<!-- Tab strip (horizontal) -->
		<div class="flex flex-row border-b border-brd shrink-0 px-2 pt-2 gap-0.5">
			<button
				v-for="tab in TABS"
				:key="tab.id"
				@click="selectTab(tab)"
				:class="[
					'relative px-3 py-1.5 text-xs font-medium rounded-t transition-colors',
					tab.soon
						? 'text-t1/30 cursor-default'
						: activeTab === tab.id
							? 'text-accent border-b-2 border-accent -mb-px bg-accent/10'
							: 'text-t1/70 hover:text-t1 hover:bg-white/5',
				]"
			>
				{{ tab.label }}
				<span
					v-if="tab.soon"
					class="absolute -top-1 -right-1 text-[9px] font-bold text-t1/40 leading-none"
				>soon</span>
			</button>
		</div>

		<!-- Tab content area -->
		<div class="flex-1 overflow-y-auto p-4">

			<!-- ── Profile tab ──────────────────────────────────────── -->
			<div v-if="activeTab === 'profile'" class="flex flex-col gap-3">

				<!-- Top row: pic + identity fields -->
				<div class="flex gap-4">
					<!-- Avatar pic placeholder -->
					<div
						class="w-28 h-28 shrink-0 rounded bg-white/10 border border-brd
						       flex items-center justify-center text-4xl text-t1/30 select-none"
					>👤</div>

					<!-- Name, online indicator, key/born/account/partner -->
					<div class="flex flex-col gap-1.5 flex-1 min-w-0 pt-0.5">
						<p class="text-sm font-bold text-t1 truncate">{{ displayName }}</p>

						<!-- Online/Offline text (other-user only) -->
						<p
							v-if="!isSelf"
							:class="onlineStatus === 'online'
								? 'text-green-400 font-bold text-xs'
								: 'text-red-400 font-bold text-xs'"
						>{{ onlineStatus === 'online' ? 'Online' : 'Offline' }}</p>

						<!-- Read-only stub fields -->
						<div class="flex flex-col gap-1 mt-1">
							<div
								v-for="field in [
									{ label: 'Key',     value: profileUUID },
									{ label: 'Born',    value: 'N/A' },
									{ label: 'Account', value: 'Resident' },
									{ label: 'Partner', value: 'None' },
								]"
								:key="field.label"
								class="flex items-baseline gap-2"
							>
								<span class="text-[10px] text-t1/40 w-14 shrink-0">{{ field.label }}</span>
								<span class="text-[11px] text-t1/70 truncate font-mono select-all">{{ field.value }}</span>
							</div>
						</div>
					</div>
				</div>

				<!-- Groups -->
				<div>
					<p class="text-[10px] text-t1/40 mb-1">Groups</p>
					<div
						class="rounded bg-white/5 border border-brd px-2 py-1.5
						       text-xs text-t1/40 italic min-h-[2rem]"
					>(none)</div>
				</div>

				<!-- About / bio -->
				<div class="flex flex-col gap-1">
					<p class="text-[10px] text-t1/40">About</p>

					<!-- Editable for self -->
					<textarea
						v-if="isSelf"
						v-model="bioEdit"
						rows="5"
						placeholder="Write something about yourself…"
						class="w-full rounded bg-white/5 border border-brd px-2 py-1.5
						       text-xs text-t1 placeholder-t1/30 resize-none
						       focus:outline-none focus:border-accent/60 transition-colors"
					/>

					<!-- Read-only for other -->
					<div
						v-else
						class="rounded bg-white/5 border border-brd px-2 py-1.5
						       text-xs text-t1/70 min-h-[5rem] whitespace-pre-wrap"
					>(no about text)</div>
				</div>

				<!-- Save / Discard (self, dirty only) -->
				<div v-if="isSelf && bioDirty" class="flex justify-end gap-2 mt-1">
					<button
						@click="discardBio"
						class="px-3 py-1 text-xs rounded border border-brd
						       text-t1/60 hover:text-t1 hover:bg-white/5 transition-colors"
					>Discard</button>
					<button
						@click="saveBio"
						class="px-3 py-1 text-xs rounded bg-accent text-white
						       hover:bg-accent/80 transition-colors"
					>Save</button>
				</div>
			</div>

			<!-- ── Notes tab ─────────────────────────────────────────── -->
			<div v-else-if="activeTab === 'notes'" class="flex flex-col gap-2 h-full">
				<p class="text-[10px] text-t1/40 shrink-0">Private notes — only visible to you</p>
				<textarea
					v-model="notes"
					@input="saveNotes"
					rows="14"
					placeholder="Notes about this person…"
					class="w-full flex-1 rounded bg-white/5 border border-brd px-2 py-1.5
					       text-xs text-t1 placeholder-t1/30 resize-none
					       focus:outline-none focus:border-accent/60 transition-colors"
				/>
			</div>

			<!-- ── Coming soon (Interests / Picks / 1st Life) ────────── -->
			<div v-else class="flex flex-col items-center justify-center h-40 gap-2">
				<span class="text-2xl opacity-30">🚧</span>
				<p class="text-sm text-t1/40">Coming soon</p>
			</div>
		</div>

		<!-- Bottom action buttons (other-user only, all disabled Phase 1) -->
		<div
			v-if="!isSelf"
			class="shrink-0 border-t border-brd px-4 py-2 flex gap-2 flex-wrap"
		>
			<button
				v-for="btn in ['IM', 'Pay', 'Block', 'Find on Map', 'Offer TP', 'Remove Friend']"
				:key="btn"
				disabled
				class="px-2.5 py-1 text-xs rounded border border-brd
				       text-t1/30 cursor-not-allowed opacity-50"
			>{{ btn }}</button>
		</div>
	</div>
</template>
```

- [ ] **Step 2: Verify no lint errors**

```
npm run lint
```

Expected: no errors in `ProfileFloater.vue`.

- [ ] **Step 3: Commit**

```
git add src/components/ProfileFloater.vue
git commit -m "feat(profile): add ProfileFloater component"
```

---

## Task 4: App.vue — mount ProfileFloater

**Files:**
- Modify: `src/App.vue`

- [ ] **Step 1: Add import**

In `src/App.vue`, after the existing `PreferencesFloater` import (line 9):

```js
import PreferencesFloater from '@/components/PreferencesFloater.vue'
import ProfileFloater     from '@/components/ProfileFloater.vue'
```

- [ ] **Step 2: Mount in template**

In `src/App.vue`, the template currently reads:

```html
<template>
<RouterView />
<!-- WHY: PreferencesFloater lives at app root — accessible pre-login and post-login via Ctrl+P -->
<PreferencesFloater v-if="ui.showPreferences" />
</template>
```

Change it to:

```html
<template>
<RouterView />
<!-- WHY: PreferencesFloater lives at app root — accessible pre-login and post-login via Ctrl+P -->
<PreferencesFloater v-if="ui.showPreferences" />
<!-- WHY: ProfileFloater at app root so it works pre-login and post-login -->
<ProfileFloater v-if="ui.showProfile" />
</template>
```

- [ ] **Step 3: Commit**

```
git add src/App.vue
git commit -m "feat(profile): mount ProfileFloater in App.vue"
```

---

## Task 5: MenuBar.vue — wire Profile menu item

**Files:**
- Modify: `src/components/MenuBar.vue`

- [ ] **Step 1: Enable Profile… item**

In `src/components/MenuBar.vue`, the Avatar menu currently has (around line 72):

```js
{ label: 'Profile…', disabled: true },
```

Replace it with:

```js
{ label: 'Profile…', action: () => act(() => ui.openProfile()) },
```

(`disabled: true` removed; `action` wired to `ui.openProfile()` with no argument = self)

- [ ] **Step 2: Commit**

```
git add src/components/MenuBar.vue
git commit -m "feat(profile): enable Profile menu item in MenuBar"
```

---

## Task 6: Manual verification

**No test framework for components — verify in browser.**

- [ ] **Step 1: Start dev servers**

Terminal 1:
```
npm run dev
```

Terminal 2:
```
npm run dev:server
```

Open `http://localhost:5173` in browser. Log in (or use dev mode).

- [ ] **Step 2: Open Profile floater**

Click Avatar menu → Profile…

Expected:
- Floater opens, centered
- Shows 5 horizontal tabs: Profile | Interests | Picks | 1st Life | Notes
- Interests/Picks/1st Life show "soon" badge, clicking does nothing
- Profile tab active by default

- [ ] **Step 3: Verify Profile tab (self)**

Expected:
- 👤 placeholder pic at left
- Display name shown in bold (from avatarStore.displayName)
- No Online/Offline text (self)
- Key shows UUID (or "—" if not set)
- Born = N/A, Account = Resident, Partner = None
- Groups = "(none)"
- About textarea is editable
- No Save/Discard buttons initially

- [ ] **Step 4: Test bio save**

Type text in About textarea.

Expected:
- Save and Discard buttons appear
- Click Save → buttons disappear, value persists after closing and reopening floater
- Click Discard → reverts text, buttons disappear

- [ ] **Step 5: Test Notes tab**

Click Notes tab.

Expected:
- Textarea shown with placeholder "Notes about this person…"
- Type text → auto-saves on input
- Close floater, reopen → Notes tab text still there (localStorage persistence)

- [ ] **Step 6: Test close behaviors**

- Click × button → closes
- Click backdrop → closes
- Press Escape → closes

- [ ] **Step 7: Run all tests**

```
npx vitest run
```

Expected: all tests pass including the 2 new test files.

- [ ] **Step 8: Final commit**

```
git add -A
git commit -m "feat(profile): ProfileFloater complete — self view with bio + notes"
```
