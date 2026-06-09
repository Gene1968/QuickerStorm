# Memory-Budget Distance Culling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bound resident memory on dense regions by evicting the farthest-from-camera objects when the JS heap exceeds a budget, and streaming them back from local cache as the camera approaches — with a `% loaded` indicator.

**Architecture:** A ~1 s cull tick in `useWorldEngine` reads `memRatio()`. Over budget (~0.60) → dispose the farthest resident meshes (reusing `removeMesh`); under budget → re-queue the nearest evicted objects for rebuild (reusing `pendingMeshIds`/`drainMeshQueue`). The ranking is a pure, unit-tested policy module. Evicted objects keep their `worldStore` record + IDB caches, so rebuild needs no grid re-fetch. Stats flow to a reactive `worldStore.cullStats` rendered in the Prefs cache panel and a corner badge.

**Tech Stack:** Vue 3 + Pinia, Three.js r184, Bun test runner (`bun:test`), Vite. Tabs not spaces.

**Spec:** `docs/superpowers/specs/2026-06-09-memory-budget-culling-design.md`

---

## File Structure

- **Create** `src/lib/cullPolicy.js` — pure ranking: `selectEvictions(candidates, maxN)`, `selectReloads(candidates, rNear, maxN)`. No THREE/DOM. One responsibility: order ids by distance + apply caps.
- **Create** `src/__tests__/lib/cullPolicy.test.js` — unit tests.
- **Modify** `src/stores/worldStore.js` — add `cullStats` ref + `setCullStats`.
- **Modify** `src/composables/useWorldEngine.js` — `evicted` Set, `cullTick()`, constants, timer wire + teardown, evicted-set maintenance on update/clear, `memRatio` import.
- **Modify** `src/components/PreferencesFloater.vue` — a "Scene" cache card showing `cullStats`.
- **Create** `src/components/SceneLoadBadge.vue` — tiny upper-right `% loaded` badge; mount in `WorldView.vue`.

---

## Task 1: `cullPolicy` pure module

**Files:**
- Create: `src/lib/cullPolicy.js`
- Test: `src/__tests__/lib/cullPolicy.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/lib/cullPolicy.test.js`:

```js
import { describe, it, expect } from 'bun:test'
import { selectEvictions, selectReloads } from '@/lib/cullPolicy.js'

describe('selectEvictions', () => {
	it('evicts farthest first, capped at maxN', () => {
		const cands = [{ id: 1, dist: 10 }, { id: 2, dist: 90 }, { id: 3, dist: 50 }, { id: 4, dist: 200 }]
		expect(selectEvictions(cands, 2)).toEqual([4, 2])  // farthest two, farthest first
	})
	it('returns all (farthest-first) when maxN exceeds count', () => {
		expect(selectEvictions([{ id: 7, dist: 5 }, { id: 8, dist: 8 }], 10)).toEqual([8, 7])
	})
	it('empty candidates → []', () => {
		expect(selectEvictions([], 5)).toEqual([])
	})
	it('does not mutate the input array', () => {
		const cands = [{ id: 1, dist: 1 }, { id: 2, dist: 2 }]
		selectEvictions(cands, 1)
		expect(cands.map(c => c.id)).toEqual([1, 2])
	})
})

describe('selectReloads', () => {
	it('reloads nearest first, only within rNear, capped at maxN', () => {
		const cands = [{ id: 1, dist: 30 }, { id: 2, dist: 200 }, { id: 3, dist: 10 }, { id: 4, dist: 96 }]
		expect(selectReloads(cands, 96, 2)).toEqual([3, 1])  // within 96, nearest two
	})
	it('excludes anything beyond rNear', () => {
		expect(selectReloads([{ id: 5, dist: 500 }], 96, 5)).toEqual([])
	})
	it('empty candidates → []', () => {
		expect(selectReloads([], 96, 5)).toEqual([])
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/__tests__/lib/cullPolicy.test.js`
Expected: FAIL — `Cannot find module '@/lib/cullPolicy.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/cullPolicy.js`:

```js
// src/lib/cullPolicy.js — pure ranking for memory-budget distance culling. The engine computes each
// candidate's distance to the camera (it owns THREE/camera) and passes plain {id, dist} objects;
// this module just orders + caps, so it is unit-testable without THREE or the DOM. Total + pure.

// Farthest-first, capped at maxN. Used when over the memory budget: evict the most-distant resident
// objects. `candidates` must already exclude protected ids (avatars / own / selected).
export function selectEvictions(candidates, maxN) {
	return [...candidates].sort((a, b) => b.dist - a.dist).slice(0, maxN).map(c => c.id)
}

// Nearest-first within rNear, capped at maxN. Used when there is headroom: rebuild the closest
// previously-evicted objects. Anything beyond rNear is left evicted (hysteresis vs the evict radius).
export function selectReloads(candidates, rNear, maxN) {
	return candidates
		.filter(c => c.dist <= rNear)
		.sort((a, b) => a.dist - b.dist)
		.slice(0, maxN)
		.map(c => c.id)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/__tests__/lib/cullPolicy.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/cullPolicy.js src/__tests__/lib/cullPolicy.test.js
git commit -m "feat(render): pure cull policy — farthest-evict / nearest-reload ranking"
```

---

## Task 2: `worldStore.cullStats`

**Files:**
- Modify: `src/stores/worldStore.js`

- [ ] **Step 1: Add the ref + setter**

In `src/stores/worldStore.js`, find the `const objects = ref(new Map())` line (~line 10) and add right after it:

```js
	// Culling telemetry for the % -loaded badge + Prefs. resident/known are non-avatar mesh counts.
	const cullStats = ref({ resident: 0, known: 0, evicted: 0, pct: 100 })
	function setCullStats(s) { cullStats.value = s }
```

- [ ] **Step 2: Export them**

Find the `return {` block (~line 130, `return { objects, avatars, prims,`) and add `cullStats` and `setCullStats` to the returned object. For example change:

```js
	return {
		objects, avatars, prims,
```

to:

```js
	return {
		objects, avatars, prims, cullStats, setCullStats,
```

- [ ] **Step 3: Verify the store still loads (build)**

Run: `npm run build:staging`
Expected: `✓ built`, no errors.

- [ ] **Step 4: Commit**

```bash
git add src/stores/worldStore.js
git commit -m "feat(store): worldStore.cullStats for scene-load telemetry"
```

---

## Task 3: Cull manager in `useWorldEngine`

**Files:**
- Modify: `src/composables/useWorldEngine.js`

> Locate by the quoted code, not line numbers. Existing facts: `removeMesh(localId)` disposes geometry+materials (array-aware); `slToThree(x,y,z)` returns `new THREE.Vector3(x, z, -y)`; `camera` is a closure var with `.position`; `ownAvatarLocalId`, `meshMap` (Map localId→mesh), `pendingMeshIds` (Set), `PCODE_AVATAR`, and `worldStore`/`uiStore` are all in scope; the engine has a `_meshDrainTimer`/`_assetStatsTimer` setInterval block in `onMounted` and a matching `clearInterval` block in `onUnmounted`.

- [ ] **Step 1: Import `memRatio`**

Find the memGovernor import added earlier:

```js
import { memStats, memUnderPressure } from '@/lib/memGovernor.js'
```

Change it to:

```js
import { memStats, memUnderPressure, memRatio } from '@/lib/memGovernor.js'
```

Add the cull-policy import next to the other `@/lib` imports (e.g. after the `memGovernor` line):

```js
import { selectEvictions, selectReloads } from '@/lib/cullPolicy.js'
```

- [ ] **Step 2: Add the evicted set + tunables + timer handle**

Find the timer-handle declarations:

```js
	let _assetStatsTimer = null  // setInterval handle for asset-loading telemetry
	let _meshDrainTimer = null   // mesh build/reparent driver — focus-independent (see onMounted)
	let _texBackfillTimer = null // re-applies textures to still-white meshes + drives fetch retries
```

Add after them:

```js
	let _cullTimer = null        // memory-budget distance-culling tick (~1s)
	const evicted = new Set()    // localIds dropped for memory (kept in worldStore + IDB; rebuilt on approach)
	// WHY a budget below the 0.85 governor: park heap ~60% so the governor is a rare backstop, not the
	// steady state. R_NEAR < (implicit evict radius): far objects evict first under pressure; only
	// objects within R_NEAR rebuild — hysteresis prevents thrash at the boundary. Per-tick caps spread
	// the dispose/build work so the frame doesn't hitch.
	const CULL_TARGET = 0.60
	const R_NEAR = 96            // metres — rebuild evicted objects within this range when headroom exists
	const MAX_EVICT_PER_TICK = 200
	const MAX_RELOAD_PER_TICK = 100
```

- [ ] **Step 3: Add `cullTick()` + stats helper**

Add this function near `drainMeshQueue` (anywhere in the composable body, before the `onMounted` that wires timers):

```js
	// Distance from the camera (THREE space) to an object's SL position. Infinity if unknown so a
	// position-less object sorts as "farthest" (evicted first / never reloaded).
	function camDistToObj(obj) {
		if (!obj?.pos || !camera) return Infinity
		const t = slToThree(obj.pos[0], obj.pos[1], obj.pos[2])
		return camera.position.distanceTo(t)
	}

	// Recompute scene-load telemetry (non-avatar resident vs known) → worldStore for the badge/Prefs.
	function updateCullStats() {
		let resident = 0
		for (const id of meshMap.keys()) {
			const o = worldStore.objects.get(id)
			if (!o || o.pcode !== PCODE_AVATAR) resident++   // count non-avatar resident meshes
		}
		let known = 0
		for (const o of worldStore.objects.values()) if (o.pcode !== PCODE_AVATAR) known++
		const pct = known > 0 ? Math.round((resident / known) * 100) : 100
		worldStore.setCullStats({ resident, known, evicted: evicted.size, pct })
	}

	// Memory-budget distance culling. Over target → evict farthest resident meshes; under target →
	// rebuild nearest evicted objects. Chrome-gated (memRatio null elsewhere → no-op).
	function cullTick() {
		const r = memRatio()
		if (r == null || !camera) { return }
		if (r > CULL_TARGET) {
			const editId = uiStore.editObjectId
			const cands = []
			for (const [id, mesh] of meshMap) {
				const obj = worldStore.objects.get(id)
				if (!obj) continue
				if (obj.pcode === PCODE_AVATAR) continue   // never evict avatars
				if (id === ownAvatarLocalId || id === editId) continue
				cands.push({ id, dist: camDistToObj(obj) })
			}
			const ids = selectEvictions(cands, MAX_EVICT_PER_TICK)
			for (const id of ids) { removeMesh(id); pendingMeshIds.delete(id); evicted.add(id) }
		} else if (evicted.size) {
			const cands = []
			for (const id of evicted) {
				const obj = worldStore.objects.get(id)
				if (!obj) { evicted.delete(id); continue }   // object gone (KillObject) → forget it
				cands.push({ id, dist: camDistToObj(obj) })
			}
			const ids = selectReloads(cands, R_NEAR, MAX_RELOAD_PER_TICK)
			for (const id of ids) { evicted.delete(id); pendingMeshIds.add(id) }
		}
		updateCullStats()
	}
```

- [ ] **Step 4: Wire the timer in `onMounted`**

Find the drain-timer setup:

```js
		_meshDrainTimer = setInterval(() => {
			drainMeshQueue()
			pumpTextures()   // resume governor-paused texture fetches once heap pressure clears
			if ((_drainTick++ & 3) === 0) reparentOrphans()
		}, 30)
```

Add immediately after that statement:

```js
		_cullTimer = setInterval(cullTick, 1000)
```

- [ ] **Step 5: Clear the timer in `onUnmounted`**

Find the teardown:

```js
		if (_meshDrainTimer) { clearInterval(_meshDrainTimer); _meshDrainTimer = null }
```

Add after it:

```js
		if (_cullTimer) { clearInterval(_cullTimer); _cullTimer = null }
		evicted.clear()
```

- [ ] **Step 6: Maintain the evicted set on update + region clear**

(a) An inbound update for an evicted id must un-evict it (the normal upsert rebuilds it). Find `pendingMeshIds.clear()  // perf: drop queued mesh builds on region change` (there are two such lines — the teleport scene-clear and the unmount). At BOTH occurrences, add `evicted.clear()` on the next line:

```js
		pendingMeshIds.clear()  // perf: drop queued mesh builds on region change
		evicted.clear()
```

(b) When a queued prim is dropped on KillObject, find `pendingMeshIds.delete(id)  // perf: drop a queued-but-unbuilt mesh` and add after it:

```js
			evicted.delete(id)
```

(c) Un-evict on a fresh update: find `pendingMeshIds.add(obj.localId)` (the upsert path that queues a mesh build, ~line 1894) and add immediately before it:

```js
				evicted.delete(obj.localId)
```

- [ ] **Step 7: Build + run unit tests**

Run: `npm run build:staging`
Expected: `✓ built`, no errors.

Run: `bun test src/__tests__/lib/cullPolicy.test.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/composables/useWorldEngine.js
git commit -m "feat(render): memory-budget distance culling — evict far, rebuild near"
```

- [ ] **Step 9: Live verify (user)**

Load the dense region. Expect: heap parks near 60% (DebugPanel `[Mem]`), no crash, scene fills; moving the camera streams distant objects out and near ones back in; revisiting does NOT spike `reqMulti` on the server (rebuild is from cache, not grid). If the camera's immediate surroundings flicker/evict, raise `CULL_TARGET` or `R_NEAR`.

---

## Task 4: Prefs "Scene" card

**Files:**
- Modify: `src/components/PreferencesFloater.vue`

- [ ] **Step 1: Ensure the world store is available in the script**

In `<script setup>`, if `useWorldStore` is not already imported, add it with the other store imports and instantiate:

```js
import { useWorldStore } from '@/stores/worldStore'
const world = useWorldStore()
```

(If `world` already exists, skip.)

- [ ] **Step 2: Add the Scene card to the template**

Find the Object Cache card block that starts with:

```html
							<!-- Object Cache (persistent scene per region — instant reload paint) -->
							<div class="pf-cache-card">
```

Immediately BEFORE that `<!-- Object Cache ... -->` comment, insert:

```html
							<!-- Scene (resident vs known objects — memory-budget culling) -->
							<div class="pf-cache-card">
								<div class="pf-cache-header">
									<span class="pf-cache-title">Scene</span>
								</div>
								<div class="pf-cache-stats">
									<span class="pf-cache-stat">
										<span class="pf-cache-label">Loaded</span>
										<span class="pf-cache-val">{{ world.cullStats.pct }}%</span>
									</span>
									<span class="pf-cache-sep">·</span>
									<span class="pf-cache-stat">
										<span class="pf-cache-label">Resident</span>
										<span class="pf-cache-val">{{ world.cullStats.resident.toLocaleString() }} / {{ world.cullStats.known.toLocaleString() }}</span>
									</span>
									<span class="pf-cache-sep">·</span>
									<span class="pf-cache-stat">
										<span class="pf-cache-label">Evicted (memory)</span>
										<span class="pf-cache-val">{{ world.cullStats.evicted.toLocaleString() }}</span>
									</span>
								</div>
							</div>
```

- [ ] **Step 3: Build**

Run: `npm run build:staging`
Expected: `✓ built`, no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/PreferencesFloater.vue
git commit -m "feat(ui): Prefs Scene card — resident/known/evicted + % loaded"
```

---

## Task 5: Corner `% loaded` badge

**Files:**
- Create: `src/components/SceneLoadBadge.vue`
- Modify: `src/views/WorldView.vue`

- [ ] **Step 1: Create the badge component**

Create `src/components/SceneLoadBadge.vue`:

```vue
<script setup>
import { computed } from 'vue'
import { useWorldStore } from '@/stores/worldStore'
const world = useWorldStore()
// Show only while the scene is still streaming in (and there is something to load).
const show = computed(() => world.cullStats.known > 0 && world.cullStats.pct < 100)
</script>

<template>
	<div
		v-if="show"
		class="absolute top-2 right-2 z-20 px-2 py-1 rounded bg-black/60 text-2xs font-mono text-white/80 pointer-events-none select-none"
		:title="`Resident ${world.cullStats.resident} / known ${world.cullStats.known} · evicted ${world.cullStats.evicted} for memory`"
	>
		scene {{ world.cullStats.pct }}%
	</div>
</template>
```

- [ ] **Step 2: Mount it in WorldView**

In `src/views/WorldView.vue`, add the import with the other component imports (near `import WorldCanvas from '@/components/WorldCanvas.vue'`):

```js
import SceneLoadBadge		from '@/components/SceneLoadBadge.vue'
```

Then find the `<WorldCanvas class="absolute inset-0" />` line and add immediately after it:

```html
				<SceneLoadBadge />
```

- [ ] **Step 3: Build**

Run: `npm run build:staging`
Expected: `✓ built`, no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/SceneLoadBadge.vue src/views/WorldView.vue
git commit -m "feat(ui): upper-right scene %-loaded badge"
```

- [ ] **Step 5: Live verify (user)**

On the dense region the badge shows `scene NN%` rising as objects build, hides at 100%. Hovering shows resident/known/evicted. Matches the Prefs Scene card.

---

## Final verification

- [ ] `bun test src/__tests__/lib/cullPolicy.test.js` → pass.
- [ ] `npm run build:staging` → `✓ built`.
- [ ] Live: dense region holds ~60% heap, no crash, full scene streams by distance, `% loaded` rises, no grid re-fetch on revisit.
- [ ] Update memory `render-pipeline-state`: governor + 256 texture cap + memory-budget culling shipped; note culling is Chrome-gated (`performance.memory`).
