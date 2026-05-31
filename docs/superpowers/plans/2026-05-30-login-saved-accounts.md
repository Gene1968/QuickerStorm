# Login Saved Accounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-grid single-credential storage with a multi-account combobox that links username, grid, and password — matching Firestorm's login panel behavior.

**Architecture:** New `accountsStore` Pinia store manages `qs_saved_accounts` in localStorage; one-time migration imports legacy `qs_autologin_*` keys. `LoginForm` username input becomes a native `<datalist>` combobox; selecting an entry auto-switches grid + injects password. Preferences floater gains an Accounts tab for removal.

**Tech Stack:** Vue 3 `<script setup>`, Pinia, Vitest, native HTML `<datalist>`

**Spec:** `docs/superpowers/specs/2026-05-30-login-saved-accounts-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/stores/accountsStore.js` | `qs_saved_accounts` CRUD, migration from `qs_autologin_*`, orphan filtering |
| Create | `src/__tests__/stores/accountsStore.test.js` | Vitest unit tests for the store |
| Modify | `src/components/LoginForm.vue` | Combobox, `onAccountSelect`, updated `submit()` |
| Modify | `src/components/PreferencesFloater.vue` | Accounts tab (list + remove) |

---

## Task 1: accountsStore — tests + implementation

**Files:**
- Create: `src/stores/accountsStore.js`
- Create: `src/__tests__/stores/accountsStore.test.js`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/stores/accountsStore.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAccountsStore } from '@/stores/accountsStore'

beforeEach(() => {
	setActivePinia(createPinia())
	localStorage.clear()
})

describe('accountsStore', () => {
	it('starts with empty accounts', () => {
		const store = useAccountsStore()
		expect(store.accounts).toEqual([])
	})

	it('addOrUpdate adds an account', () => {
		const store = useAccountsStore()
		store.addOrUpdate('Gene Freenote', 'osgrid', 'secret')
		expect(store.accounts).toHaveLength(1)
		expect(store.accounts[0].username).toBe('Gene Freenote')
		expect(store.accounts[0].gridNick).toBe('osgrid')
	})

	it('addOrUpdate updates existing account (case-insensitive username)', () => {
		const store = useAccountsStore()
		store.addOrUpdate('Gene Freenote', 'osgrid', 'old')
		store.addOrUpdate('gene freenote', 'osgrid', 'new')
		expect(store.accounts).toHaveLength(1)
		expect(store.accounts[0].password).toBe('new')
	})

	it('same username on different grids = two entries', () => {
		const store = useAccountsStore()
		store.addOrUpdate('Gene Freenote', 'osgrid', 'pass1')
		store.addOrUpdate('Gene Freenote', 'agni', 'pass2')
		expect(store.accounts).toHaveLength(2)
	})

	it('getPassword returns password for known account', () => {
		const store = useAccountsStore()
		store.addOrUpdate('Gene Freenote', 'osgrid', 'mypass')
		expect(store.getPassword('Gene Freenote', 'osgrid')).toBe('mypass')
	})

	it('getPassword is case-insensitive on username', () => {
		const store = useAccountsStore()
		store.addOrUpdate('Gene Freenote', 'osgrid', 'mypass')
		expect(store.getPassword('GENE FREENOTE', 'osgrid')).toBe('mypass')
	})

	it('getPassword returns null for unknown account', () => {
		const store = useAccountsStore()
		expect(store.getPassword('Nobody', 'osgrid')).toBeNull()
	})

	it('remove deletes matching account', () => {
		const store = useAccountsStore()
		store.addOrUpdate('Gene Freenote', 'osgrid', 'pass')
		store.remove('Gene Freenote', 'osgrid')
		expect(store.accounts).toHaveLength(0)
	})

	it('remove leaves other accounts intact', () => {
		const store = useAccountsStore()
		store.addOrUpdate('Gene Freenote', 'osgrid', 'pass1')
		store.addOrUpdate('Gene Freenote', 'agni', 'pass2')
		store.remove('Gene Freenote', 'osgrid')
		expect(store.accounts).toHaveLength(1)
		expect(store.accounts[0].gridNick).toBe('agni')
	})

	it('accounts sorted by lastUsed descending', async () => {
		const store = useAccountsStore()
		store.addOrUpdate('Alice', 'osgrid', 'p1')
		await new Promise(r => setTimeout(r, 10))
		store.addOrUpdate('Bob', 'osgrid', 'p2')
		expect(store.accounts[0].username).toBe('Bob')
	})

	it('migrates legacy qs_autologin_* keys on first load', () => {
		localStorage.setItem('qs_autologin_osgrid', JSON.stringify({ username: 'Gene', password: 'old' }))
		const store = useAccountsStore()
		expect(store.accounts.find(a => a.gridNick === 'osgrid')?.username).toBe('Gene')
		expect(localStorage.getItem('qs_autologin_osgrid')).toBeNull()
	})

	it('skips migration if qs_saved_accounts already exists', () => {
		localStorage.setItem('qs_saved_accounts', JSON.stringify([
			{ username: 'Existing', gridNick: 'osgrid', password: 'x', lastUsed: 1 },
		]))
		localStorage.setItem('qs_autologin_osgrid', JSON.stringify({ username: 'Legacy', password: 'old' }))
		const store = useAccountsStore()
		expect(store.accounts.find(a => a.username === 'Legacy')).toBeUndefined()
	})

	it('persists accounts across store instances', () => {
		const s1 = useAccountsStore()
		s1.addOrUpdate('Gene Freenote', 'osgrid', 'pass')
		// Simulate a new store instance reading from localStorage
		setActivePinia(createPinia())
		const s2 = useAccountsStore()
		expect(s2.accounts.find(a => a.gridNick === 'osgrid')?.username).toBe('Gene Freenote')
	})
})
```

- [ ] **Step 2: Run tests to verify they fail**

```
npm test src/__tests__/stores/accountsStore.test.js
```

Expected: all tests FAIL with `Cannot find module '@/stores/accountsStore'`

- [ ] **Step 3: Create the store**

Create `src/stores/accountsStore.js`:

```js
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useGridStore } from '@/stores/gridStore'

const STORAGE_KEY = 'qs_saved_accounts'
const LEGACY_PREFIX = 'qs_autologin_'

export const useAccountsStore = defineStore('accounts', () => {
	const gridStore = useGridStore()

	function _load() {
		try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') }
		catch { return [] }
	}

	function _save(list) {
		try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)) } catch {}
	}

	function _matchKey(a, username, gridNick) {
		return a.username.toLowerCase() === username.toLowerCase() && a.gridNick === gridNick
	}

	// One-time migration from legacy per-grid credential keys
	if (localStorage.getItem(STORAGE_KEY) === null) {
		const imported = []
		const oldKeys = []
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i)
			if (!key?.startsWith(LEGACY_PREFIX)) continue
			oldKeys.push(key)
			try {
				const { username, password } = JSON.parse(localStorage.getItem(key))
				if (username) imported.push({ username, gridNick: key.slice(LEGACY_PREFIX.length), password: password ?? '', lastUsed: 0 })
			} catch {}
		}
		_save(imported)
		oldKeys.forEach(k => localStorage.removeItem(k))
	}

	const _raw = ref(_load())

	const accounts = computed(() => {
		const validNicks = new Set(gridStore.grids.map(g => g.nick))
		return _raw.value
			.filter(a => validNicks.has(a.gridNick))
			.sort((a, b) => b.lastUsed - a.lastUsed)
	})

	function addOrUpdate(username, gridNick, password) {
		const list = _load()
		const idx = list.findIndex(a => _matchKey(a, username, gridNick))
		const entry = { username, gridNick, password, lastUsed: Date.now() }
		if (idx >= 0) list[idx] = entry
		else list.push(entry)
		_save(list)
		_raw.value = list
	}

	function remove(username, gridNick) {
		const list = _load().filter(a => !_matchKey(a, username, gridNick))
		_save(list)
		_raw.value = list
	}

	function getPassword(username, gridNick) {
		return _load().find(a => _matchKey(a, username, gridNick))?.password ?? null
	}

	return { accounts, addOrUpdate, remove, getPassword }
})
```

- [ ] **Step 4: Run tests to verify they pass**

```
npm test src/__tests__/stores/accountsStore.test.js
```

Expected: all 13 tests PASS

- [ ] **Step 5: Commit**

```
git add src/stores/accountsStore.js src/__tests__/stores/accountsStore.test.js
git commit -m "feat(accounts): accountsStore with migration from legacy per-grid keys"
```

---

## Task 2: LoginForm combobox + updated submit

**Files:**
- Modify: `src/components/LoginForm.vue`

- [ ] **Step 1: Update `<script setup>` — imports and store**

At the top of `<script setup>`, add the import and instantiate the store:

```js
import { useAccountsStore } from '@/stores/accountsStore'
// (add after the existing useGridStore import)

const accountsStore = useAccountsStore()
// (add after const gridStore = useGridStore())
```

- [ ] **Step 2: Remove legacy credential code**

Delete these lines from `<script setup>` (lines 15–40 in current file):

```js
// ── Remember Me — per-grid credential storage ─────────────────────────────
// WHY: Each grid is a separate service with separate accounts. Storing under
// one flat key would clobber credentials when the user switches grids.
const AUTOLOGIN_PREFIX = 'qs_autologin_'
function autologinKey() { return `${AUTOLOGIN_PREFIX}${gridStore.selectedNick}` }

// WHY: Pre-fill from stored creds for the active grid. Called on mount and
// whenever the user switches grids so the form always shows the right creds.
function loadCredsForGrid() {
	try {
		const stored = JSON.parse(localStorage.getItem(autologinKey()))
		username.value   = stored?.username ?? ''
		password.value   = stored?.password ?? ''
		// WHY: If this grid has stored creds, keep rememberMe on so a one-click
		// retry works after auto-reconnect failure.
		rememberMe.value = !!(stored?.username && stored?.password)
	} catch {
		username.value = ''
		password.value = ''
	}
}

onMounted(loadCredsForGrid)
// WHY: Reload credentials immediately when user picks a different grid from
// the dropdown — not just on next submit — so the form is always in sync.
watch(() => gridStore.selectedNick, loadCredsForGrid)
```

Also remove `onMounted` from the Vue import since it is no longer used:

```js
import { ref, computed, watch, nextTick } from 'vue'
```

- [ ] **Step 3: Add grid-change watcher and `onAccountSelect` handler**

After the `const rememberMe = ref(true)` line, add:

```js
// Clear form when user switches grid via GridSelector (not via account combobox)
watch(() => gridStore.selectedNick, () => {
	username.value = ''
	password.value = ''
})

// Fires when the username input changes. If the value matches a saved-account
// datalist option ("Username @ GridName"), auto-switch grid and inject password.
function onAccountSelect() {
	const val = username.value
	const match = val.match(/^(.+)\s@\s(.+)$/)
	if (!match) return
	const [, rawUser, gridName] = match
	const grid = gridStore.grids.find(g => g.name === gridName)
	if (!grid) return
	const stored = accountsStore.getPassword(rawUser, grid.nick)
	if (stored === null) return
	username.value = rawUser
	gridStore.selectGrid(grid.nick)
	password.value = stored
}
```

- [ ] **Step 4: Replace submit handler**

Replace the entire `async function submit()` block with:

```js
async function submit() {
	error.value = ''
	if (destType.value === 'region' && destRegion.value.trim()) {
		saveRecent(gridStore.selectedNick, destRegion.value.trim())
	}
	// WHY: Capture before await — component may unmount after login() triggers
	// router.push(). Store references survive unmount, primitive captures do too.
	const user     = username.value
	const grid     = gridStore.selectedNick
	const pass     = password.value
	const remember = rememberMe.value
	try {
		await login(user, pass, destination.value)
		if (remember) accountsStore.addOrUpdate(user, grid, pass)
	} catch (e) {
		error.value = e.message
	}
}
```

- [ ] **Step 5: Replace username input in template**

Replace the existing username `<input>` block:

```html
<input
	v-model="username"
	type="text"
	placeholder="First Last"
	autocomplete="username"
	class="reset-input px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-accent"
	required
/>
```

With:

```html
<input
	v-model="username"
	type="text"
	list="qs-saved-accounts"
	placeholder="First Last"
	autocomplete="username"
	class="reset-input px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-accent"
	required
	@input="onAccountSelect"
/>
<datalist id="qs-saved-accounts">
	<option
		v-for="acct in accountsStore.accounts"
		:key="acct.username + '@' + acct.gridNick"
		:value="acct.username + ' @ ' + (gridStore.grids.find(g => g.nick === acct.gridNick)?.name ?? acct.gridNick)"
	/>
</datalist>
```

- [ ] **Step 6: Manual smoke test**

Start the dev server (`npm run dev`) and open the login page.

Verify:
1. Username field shows a dropdown arrow when focused (browser datalist)
2. Clicking the field with no saved accounts shows empty dropdown
3. Enter any credentials, check "Remember me", log in successfully
4. Log out, return to login — username field now shows that account in dropdown
5. Type the full "Username @ GridName" entry from the dropdown — grid switches, password fills, username trims to just the name
6. Uncheck "Remember me" and log in — existing saved entry is NOT deleted

- [ ] **Step 7: Commit**

```
git add src/components/LoginForm.vue
git commit -m "feat(accounts): login combobox — saved accounts datalist with auto grid+password inject"
```

---

## Task 3: PreferencesFloater — Accounts tab

**Files:**
- Modify: `src/components/PreferencesFloater.vue`

- [ ] **Step 1: Import accountsStore and gridStore; add helper**

In `<script setup>`, add after the existing imports:

```js
import { useAccountsStore } from '@/stores/accountsStore.js'
import { useGridStore }     from '@/stores/gridStore.js'

const accountsStore = useAccountsStore()
const gridStore     = useGridStore()

function formatLastUsed(ts) {
	if (!ts) return 'Never'
	const days = Math.floor((Date.now() - ts) / 86400000)
	if (days === 0) return 'Today'
	if (days === 1) return 'Yesterday'
	if (days < 7)   return `${days} days ago`
	return new Date(ts).toLocaleDateString()
}
```

- [ ] **Step 2: Add Accounts tab to ALL_TABS**

In the `ALL_TABS` array, insert after the `general` entry:

```js
{ id: 'accounts', icon: '👤', label: 'Accounts', disabled: false, soon: false },
```

Full array becomes:

```js
const ALL_TABS = [
	{ id: 'general',       icon: '⚙️',  label: 'General',       disabled: false, soon: false },
	{ id: 'accounts',      icon: '👤',  label: 'Accounts',      disabled: false, soon: false },
	{ id: 'appearance',    icon: '🎨',  label: 'Appearance',    disabled: false, soon: false },
	{ id: 'chat',          icon: '💬',  label: 'Chat',          disabled: false, soon: true  },
	{ id: 'graphics',      icon: '🖥️',  label: 'Graphics',      disabled: false, soon: true  },
	{ id: 'sound',         icon: '🔊',  label: 'Sound & Media', disabled: false, soon: false },
	{ id: 'move',          icon: '🎮',  label: 'Move & View',   disabled: true,  soon: false },
	{ id: 'notifications', icon: '🔔',  label: 'Notifications', disabled: true,  soon: false },
	{ id: 'privacy',       icon: '🔒',  label: 'Privacy',       disabled: true,  soon: false },
	{ id: 'opensim',       icon: '🌐',  label: 'OpenSim',       disabled: false, soon: true  },
	{ id: 'advanced',      icon: '🔧',  label: 'Advanced',      disabled: true,  soon: false },
]
```

- [ ] **Step 3: Add Accounts tab content block**

In the template's `<div class="pf-content">`, immediately before `<!-- ── GENERAL ── -->`, insert:

```html
<!-- ── ACCOUNTS ── -->
<template v-if="activeTab === 'accounts'">
	<h2 class="pf-section-heading">Saved Accounts</h2>

	<template v-if="accountsStore.accounts.length">
		<div
			v-for="acct in accountsStore.accounts"
			:key="acct.username + '@' + acct.gridNick"
			class="pf-row"
		>
			<div class="pf-row-info">
				<span class="pf-row-label">
					{{ acct.username }} @ {{ gridStore.grids.find(g => g.nick === acct.gridNick)?.name ?? acct.gridNick }}
				</span>
				<span class="pf-row-hint">Last used: {{ formatLastUsed(acct.lastUsed) }}</span>
			</div>
			<button
				class="px-3 py-1 text-sm rounded border border-red-500/40 text-red-400 hover:bg-red-500/15 transition-colors"
				@click="accountsStore.remove(acct.username, acct.gridNick)"
			>Remove</button>
		</div>
	</template>
	<p v-else class="text-t2 text-sm px-1">
		No saved accounts. Check &ldquo;Remember me&rdquo; when logging in.
	</p>
</template>
```

- [ ] **Step 4: Manual smoke test**

Start the dev server (`npm run dev`).

Verify:
1. Preferences floater shows "Accounts" tab (second in list, below General)
2. Tab shows "No saved accounts" when `qs_saved_accounts` is empty
3. Log in with "Remember me" checked → open Preferences → Accounts tab shows the entry with correct "Username @ GridName" label and "Last used: Today"
4. Click Remove → entry disappears immediately
5. After removal, tab shows empty state message
6. Entries sorted by most-recent-first when multiple accounts exist

- [ ] **Step 5: Commit**

```
git add src/components/PreferencesFloater.vue
git commit -m "feat(accounts): preferences accounts tab — list and remove saved accounts"
```
