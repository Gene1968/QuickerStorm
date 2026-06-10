# Network Cache Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Network" tab to PreferencesFloater showing IndexedDB texture and mesh cache stats (entry count, size used) with per-cache clear buttons.

**Architecture:** New `formatBytes` util + stats/clear exports on both cache libs → `useCacheStats` composable (lazy IDB query on tab mount) → Network tab in PreferencesFloater. No polling, no Pinia store — point-in-time snapshot only.

**Tech Stack:** Vue 3 `<script setup>`, IndexedDB (native), Bun test runner (`bun:test`)

---

### Task 1: `src/utils/formatBytes.js` — byte formatter

**Files:**
- Create: `src/utils/formatBytes.js`
- Create: `src/__tests__/utils/formatBytes.test.js`

- [ ] **Step 1: Write the failing test**

```js
// src/__tests__/utils/formatBytes.test.js
import { describe, it, expect } from 'bun:test'
import { formatBytes } from '@/utils/formatBytes.js'

describe('formatBytes', () => {
	it('formats bytes below 1 KB', () => {
		expect(formatBytes(0)).toBe('0 B')
		expect(formatBytes(512)).toBe('512 B')
	})

	it('formats KB', () => {
		expect(formatBytes(1024)).toBe('1.0 KB')
		expect(formatBytes(1536)).toBe('1.5 KB')
	})

	it('formats MB', () => {
		expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
		expect(formatBytes(312.4 * 1024 * 1024)).toBe('312.4 MB')
	})

	it('formats GB', () => {
		expect(formatBytes(1.5 * 1024 * 1024 * 1024)).toBe('1.5 GB')
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

```
bun test src/__tests__/utils/formatBytes.test.js
```
Expected: FAIL — `Cannot find module '@/utils/formatBytes.js'`

- [ ] **Step 3: Implement formatBytes**

```js
// src/utils/formatBytes.js
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

export function formatBytes(bytes) {
	if (bytes === 0) return '0 B'
	const i = Math.min(Math.floor(Math.log2(bytes) / 10), UNITS.length - 1)
	if (i === 0) return `${bytes} B`
	return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + UNITS[i]
}
```

- [ ] **Step 4: Run test to verify it passes**

```
bun test src/__tests__/utils/formatBytes.test.js
```
Expected: 4 pass, 0 fail

- [ ] **Step 5: Commit**

```
git add src/utils/formatBytes.js src/__tests__/utils/formatBytes.test.js
git commit -m "feat(utils): add formatBytes helper"
```

---

### Task 2: `meshCache.js` — add `bytes` field + stats + clear

**Files:**
- Modify: `src/lib/meshCache.js`
- Modify: `src/__tests__/lib/meshCache.test.js`

The mesh cache currently stores `{ uuid, submeshes }`. Each submesh has `positions` (Float32Array), `normals` (Float32Array), `uvs` (Float32Array), `indices` (Uint16Array). Adding a `bytes` field on put lets us sum size without a full cursor scan. Old records without `bytes` will report 0 — acceptable undercount until they cycle out.

No DB version bump needed — adding a field to records doesn't change the store schema.

- [ ] **Step 1: Write the failing test**

Add to `src/__tests__/lib/meshCache.test.js`:

```js
import { describe, it, expect } from 'bun:test'
import { meshDbConfig, getMeshCacheStats, clearMeshCache } from '@/lib/meshCache.js'

describe('meshCache', () => {
	it('exposes a stable store name + key path', () => {
		expect(meshDbConfig.store).toBe('mesh')
		expect(meshDbConfig.keyPath).toBe('uuid')
	})

	it('exports getMeshCacheStats function', () => {
		expect(typeof getMeshCacheStats).toBe('function')
	})

	it('exports clearMeshCache function', () => {
		expect(typeof clearMeshCache).toBe('function')
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

```
bun test src/__tests__/lib/meshCache.test.js
```
Expected: FAIL — `getMeshCacheStats is not exported`

- [ ] **Step 3: Update meshCache.js**

Replace `src/lib/meshCache.js` entirely:

```js
// src/lib/meshCache.js — IndexedDB cache of decoded mesh geometry by asset UUID (immutable assets).
// Stores the submeshes JSON so re-entry/relogin skips the fetch + server decode.
const DB_NAME = 'qs-mesh', DB_VERSION = 1, STORE = 'mesh'
export const meshDbConfig = { store: STORE, keyPath: 'uuid' }

let _db = null
function openDb() {
	if (_db) return Promise.resolve(_db)
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION)
		req.onupgradeneeded = (e) => e.target.result.createObjectStore(STORE, { keyPath: 'uuid' })
		req.onsuccess = (e) => { _db = e.target.result; resolve(_db) }
		req.onerror = () => reject(req.error)
	})
}

export async function meshCacheGet(uuid) {
	try {
		const db = await openDb()
		return await new Promise((resolve, reject) => {
			const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(uuid)
			req.onsuccess = () => resolve(req.result ? req.result.submeshes : null)
			req.onerror = () => reject(req.error)
		})
	} catch { return null }
}

export async function meshCachePut(uuid, submeshes) {
	try {
		const db = await openDb()
		const bytes = submeshes.reduce((sum, s) =>
			sum + s.positions.byteLength + s.normals.byteLength +
			      s.uvs.byteLength + s.indices.byteLength, 0)
		await new Promise((resolve, reject) => {
			const tx = db.transaction(STORE, 'readwrite')
			tx.objectStore(STORE).put({ uuid, submeshes, bytes })
			tx.oncomplete = resolve
			tx.onerror = () => reject(tx.error)
		})
	} catch { /* ignore */ }
}

/** Returns { count, bytes } for the mesh cache. Old records without `bytes` field count as 0. */
export async function getMeshCacheStats() {
	try {
		const db = await openDb()
		return await new Promise((resolve, reject) => {
			const tx = db.transaction(STORE, 'readonly')
			const st = tx.objectStore(STORE)
			const countReq = st.count()
			let count = 0
			let bytes = 0
			countReq.onsuccess = () => { count = countReq.result }
			const cursor = st.openCursor()
			cursor.onsuccess = () => {
				const c = cursor.result
				if (c) { bytes += c.value.bytes ?? 0; c.continue() }
			}
			tx.oncomplete = () => resolve({ count, bytes })
			tx.onerror = () => reject(tx.error)
		})
	} catch { return { count: 0, bytes: 0 } }
}

/** Removes all entries from the mesh cache. */
export async function clearMeshCache() {
	try {
		const db = await openDb()
		await new Promise((resolve, reject) => {
			const tx = db.transaction(STORE, 'readwrite')
			tx.objectStore(STORE).clear()
			tx.oncomplete = resolve
			tx.onerror = () => reject(tx.error)
		})
	} catch { /* ignore */ }
}
```

- [ ] **Step 4: Run test to verify it passes**

```
bun test src/__tests__/lib/meshCache.test.js
```
Expected: 3 pass, 0 fail

- [ ] **Step 5: Commit**

```
git add src/lib/meshCache.js src/__tests__/lib/meshCache.test.js
git commit -m "feat(meshCache): add bytes tracking, getMeshCacheStats, clearMeshCache"
```

---

### Task 3: `textureCache.js` — add stats + clear exports

**Files:**
- Modify: `src/lib/textureCache.js`
- Modify: `src/__tests__/lib/textureCache.test.js`

`textureCache.js` already tracks `totalBytes` in the `meta` store under key `'stats'`. `getTextureCacheStats` reads that value plus a count of `tex` entries. `clearTextureCache` wipes both stores and resets the counter.

- [ ] **Step 1: Write the failing test**

Add to `src/__tests__/lib/textureCache.test.js` (keep the existing `planEvictions` tests, add below):

```js
import { describe, it, expect } from 'bun:test'
import { planEvictions, TEX_CACHE_CAP_BYTES, getTextureCacheStats, clearTextureCache } from '@/lib/textureCache.js'

// ... existing planEvictions tests unchanged ...

describe('textureCache exports', () => {
	it('exports TEX_CACHE_CAP_BYTES as 512 MB', () => {
		expect(TEX_CACHE_CAP_BYTES).toBe(512 * 1024 * 1024)
	})

	it('exports getTextureCacheStats function', () => {
		expect(typeof getTextureCacheStats).toBe('function')
	})

	it('exports clearTextureCache function', () => {
		expect(typeof clearTextureCache).toBe('function')
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

```
bun test src/__tests__/lib/textureCache.test.js
```
Expected: FAIL — `getTextureCacheStats is not exported`

- [ ] **Step 3: Add the two exports to textureCache.js**

Append to the end of `src/lib/textureCache.js` (after the existing `texCachePut`):

```js
/** Returns { count, bytes, capBytes } for the texture cache. */
export async function getTextureCacheStats() {
	try {
		const db = await openDb()
		return await new Promise((resolve, reject) => {
			const tx = db.transaction([STORE, META], 'readonly')
			const countReq = tx.objectStore(STORE).count()
			const metaReq  = tx.objectStore(META).get('stats')
			let count = 0
			let bytes = 0
			countReq.onsuccess = () => { count = countReq.result }
			metaReq.onsuccess  = () => { bytes = metaReq.result?.totalBytes ?? 0 }
			tx.oncomplete = () => resolve({ count, bytes, capBytes: TEX_CACHE_CAP_BYTES })
			tx.onerror = () => reject(tx.error)
		})
	} catch { return { count: 0, bytes: 0, capBytes: TEX_CACHE_CAP_BYTES } }
}

/** Clears all texture cache entries and resets the totalBytes counter. */
export async function clearTextureCache() {
	try {
		const db = await openDb()
		await new Promise((resolve, reject) => {
			const tx = db.transaction([STORE, META], 'readwrite')
			tx.objectStore(STORE).clear()
			tx.objectStore(META).put({ k: 'stats', totalBytes: 0 })
			tx.oncomplete = resolve
			tx.onerror = () => reject(tx.error)
		})
	} catch { /* ignore */ }
}
```

- [ ] **Step 4: Run test to verify it passes**

```
bun test src/__tests__/lib/textureCache.test.js
```
Expected: 6 pass, 0 fail (3 existing + 3 new)

- [ ] **Step 5: Commit**

```
git add src/lib/textureCache.js src/__tests__/lib/textureCache.test.js
git commit -m "feat(textureCache): add getTextureCacheStats, clearTextureCache"
```

---

### Task 4: `src/composables/useCacheStats.js` — composable

**Files:**
- Create: `src/composables/useCacheStats.js`

No IDB mocking is set up in this project, so no unit test for the composable. The Network tab (Task 5) exercises it end-to-end.

- [ ] **Step 1: Create the composable**

```js
// src/composables/useCacheStats.js
import { ref } from 'vue'
import { getTextureCacheStats, clearTextureCache } from '@/lib/textureCache.js'
import { getMeshCacheStats, clearMeshCache } from '@/lib/meshCache.js'

export function useCacheStats() {
	const texStats  = ref({ count: 0, bytes: 0, capBytes: 512 * 1024 * 1024, loading: false })
	const meshStats = ref({ count: 0, bytes: 0, loading: false })

	async function refresh() {
		texStats.value  = { ...texStats.value,  loading: true }
		meshStats.value = { ...meshStats.value, loading: true }
		const [tex, mesh] = await Promise.all([getTextureCacheStats(), getMeshCacheStats()])
		texStats.value  = { ...tex,  loading: false }
		meshStats.value = { ...mesh, loading: false }
	}

	async function clearTex() {
		texStats.value = { ...texStats.value, loading: true }
		await clearTextureCache()
		const tex = await getTextureCacheStats()
		texStats.value = { ...tex, loading: false }
	}

	async function clearMesh() {
		meshStats.value = { ...meshStats.value, loading: true }
		await clearMeshCache()
		const mesh = await getMeshCacheStats()
		meshStats.value = { ...mesh, loading: false }
	}

	return { texStats, meshStats, refresh, clearTex, clearMesh }
}
```

- [ ] **Step 2: Verify build is clean**

```
npm run build:staging 2>&1 | tail -10
```
Expected: build succeeds, no errors about missing imports.

- [ ] **Step 3: Commit**

```
git add src/composables/useCacheStats.js
git commit -m "feat(composables): add useCacheStats for Network tab"
```

---

### Task 5: `PreferencesFloater.vue` — Network tab

**Files:**
- Modify: `src/components/PreferencesFloater.vue`

Add tab entry to `ALL_TABS`, import `useCacheStats` and `formatBytes`, wire `watch` for tab open, add template block.

- [ ] **Step 1: Add import and composable init**

In `<script setup>`, after the existing imports, add:

```js
import { useCacheStats } from '@/composables/useCacheStats.js'
import { formatBytes } from '@/utils/formatBytes.js'

const cache = useCacheStats()
```

- [ ] **Step 2: Extend the watch to load cache stats on Network tab open**

The existing watch at line ~73 loads voice devices when `sound` tab opens. Extend it:

```js
watch(activeTab, async (tab) => {
	if (tab === 'sound' && voice.loadDevices) {
		try { await voice.loadDevices() } catch {}
	}
	if (tab === 'network') {
		cache.refresh()
	}
})
```

- [ ] **Step 3: Add Network to ALL_TABS**

In `ALL_TABS`, insert after the `sound` entry (between `sound` and `move`):

```js
{ id: 'network', icon: '🗄️', label: 'Network & Files', disabled: false, soon: false },
```

The full `ALL_TABS` array should now be:

```js
const ALL_TABS = [
	{ id: 'general',       icon: '⚙️',  label: 'General',        disabled: false, soon: false },
	{ id: 'accounts',      icon: '👤',  label: 'Accounts',        disabled: false, soon: false },
	{ id: 'appearance',    icon: '🎨',  label: 'Appearance',       disabled: false, soon: false },
	{ id: 'chat',          icon: '💬',  label: 'Chat',             disabled: false, soon: true  },
	{ id: 'graphics',      icon: '🖥️',  label: 'Graphics',         disabled: false, soon: true  },
	{ id: 'sound',         icon: '🔊',  label: 'Sound & Media',    disabled: false, soon: false },
	{ id: 'network',       icon: '🗄️',  label: 'Network & Files',  disabled: false, soon: false },
	{ id: 'move',          icon: '🎮',  label: 'Move & View',      disabled: true,  soon: false },
	{ id: 'notifications', icon: '🔔',  label: 'Notifications',    disabled: true,  soon: false },
	{ id: 'privacy',       icon: '🔒',  label: 'Privacy',          disabled: true,  soon: false },
	{ id: 'opensim',       icon: '🌐',  label: 'OpenSim',          disabled: false, soon: true  },
	{ id: 'advanced',      icon: '🔧',  label: 'Advanced',         disabled: true,  soon: false },
]
```

- [ ] **Step 4: Add the Network tab template block**

In the template, after the `<!-- ── OPENSIM (soon) ──` block and before `<!-- ── SEARCH EMPTY STATE ──`, insert:

```html
<!-- ── NETWORK & FILES ── -->
<template v-else-if="activeTab === 'network'">
	<h2 class="pf-section-heading">Network &amp; Files</h2>

	<!-- Texture Cache -->
	<div class="pf-cache-card">
		<div class="pf-cache-header">
			<span class="pf-cache-title">Texture Cache</span>
			<button class="qs-btn text-xs px-3 py-1" @click="cache.clearTex()" :disabled="cache.texStats.value.loading">
				Clear Textures
			</button>
		</div>
		<div class="pf-cache-stats">
			<template v-if="cache.texStats.value.loading">
				<span class="pf-cache-stat text-tm">Loading…</span>
			</template>
			<template v-else>
				<span class="pf-cache-stat">
					<span class="pf-cache-label">Entries</span>
					<span class="pf-cache-val">{{ cache.texStats.value.count.toLocaleString() }}</span>
				</span>
				<span class="pf-cache-sep">·</span>
				<span class="pf-cache-stat">
					<span class="pf-cache-label">Size</span>
					<span class="pf-cache-val">{{ formatBytes(cache.texStats.value.bytes) }} / {{ formatBytes(cache.texStats.value.capBytes) }}</span>
				</span>
			</template>
		</div>
		<div v-if="!cache.texStats.value.loading" class="pf-cache-bar-track">
			<div
				class="pf-cache-bar-fill"
				:style="{ width: Math.min(100, cache.texStats.value.bytes / cache.texStats.value.capBytes * 100).toFixed(1) + '%' }"
			/>
		</div>
	</div>

	<!-- Mesh Cache -->
	<div class="pf-cache-card">
		<div class="pf-cache-header">
			<span class="pf-cache-title">Mesh Cache</span>
			<button class="qs-btn text-xs px-3 py-1" @click="cache.clearMesh()" :disabled="cache.meshStats.value.loading">
				Clear Meshes
			</button>
		</div>
		<div class="pf-cache-stats">
			<template v-if="cache.meshStats.value.loading">
				<span class="pf-cache-stat text-tm">Loading…</span>
			</template>
			<template v-else>
				<span class="pf-cache-stat">
					<span class="pf-cache-label">Entries</span>
					<span class="pf-cache-val">{{ cache.meshStats.value.count.toLocaleString() }}</span>
				</span>
				<span class="pf-cache-sep">·</span>
				<span class="pf-cache-stat">
					<span class="pf-cache-label">Size</span>
					<span class="pf-cache-val">{{ formatBytes(cache.meshStats.value.bytes) }}</span>
				</span>
			</template>
		</div>
	</div>
</template>
```

- [ ] **Step 5: Add scoped styles for cache cards**

In `<style scoped>`, append after the `/* ── Empty state ──` block:

```css
/* ── Cache cards (Network tab) ──────────────────────────────────────────── */
.pf-cache-card {
	background: var(--color-card2);
	border: 1px solid var(--color-brd);
	border-radius: 0.5rem;
	padding: 0.75rem 1rem;
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
	margin-bottom: 0.75rem;
}

.pf-cache-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
}

.pf-cache-title {
	font-size: 0.8125rem;
	font-weight: 600;
	color: var(--color-t1);
}

.pf-cache-stats {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	font-size: 0.75rem;
}

.pf-cache-stat {
	display: flex;
	align-items: center;
	gap: 0.35rem;
}

.pf-cache-label {
	color: var(--color-tm);
}

.pf-cache-val {
	color: var(--color-t2);
	font-variant-numeric: tabular-nums;
}

.pf-cache-sep {
	color: var(--color-brd2);
}

.pf-cache-bar-track {
	height: 0.3125rem;
	background: var(--color-brd);
	border-radius: 9999px;
	overflow: hidden;
}

.pf-cache-bar-fill {
	height: 100%;
	background: var(--color-accent);
	border-radius: 9999px;
	transition: width 0.3s ease;
}
```

- [ ] **Step 6: Run all tests to confirm nothing broken**

```
bun test
```
Expected: all existing tests pass, no regressions.

- [ ] **Step 7: Verify build is clean**

```
npm run build:staging 2>&1 | tail -10
```
Expected: build succeeds.

- [ ] **Step 8: Commit**

```
git add src/components/PreferencesFloater.vue
git commit -m "feat(preferences): add Network & Files tab with cache stats"
```

---

## Self-Review

**Spec coverage:**
- ✅ Texture cache: count + size + cap + progress bar
- ✅ Mesh cache: count + size (no cap, no bar)
- ✅ Per-cache clear buttons
- ✅ `formatBytes` helper created
- ✅ Loading state per cache
- ✅ Lazy load (refresh on tab open)
- ✅ `bytes` field added to mesh cache on put
- ✅ Styling via `qs-btn` + scoped CSS + Tailwind tokens

**Placeholder scan:** None found.

**Type consistency:**
- `getTextureCacheStats` returns `{ count, bytes, capBytes }` — used as `cache.texStats.value.count / .bytes / .capBytes` ✅
- `getMeshCacheStats` returns `{ count, bytes }` — used as `cache.meshStats.value.count / .bytes` ✅
- `clearTextureCache` / `clearMeshCache` called in composable ✅
- `formatBytes` imported in PreferencesFloater and in test ✅
- `useCacheStats` returns `{ texStats, meshStats, refresh, clearTex, clearMesh }` — all used in template ✅
