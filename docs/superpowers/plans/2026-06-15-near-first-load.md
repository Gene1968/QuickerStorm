# Near-First Load Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **⚠ COMMIT POLICY (project rule [[never-auto-commit]]):** Do NOT run `git commit`. Each "Commit"
> step below gives the staged files + message to PREPARE; **Gene runs the commit himself** after
> reviewing. Treat commit steps as "stage + hand the message to Gene."

**Goal:** Make the mesh-build and texture-fetch queues dispatch nearest-to-camera first, so a heavy region's immediate surroundings build and texture in seconds instead of waiting behind far objects in FIFO order.

**Architecture:** Two pure, unit-tested helpers (`orderByDistance` in `cullPolicy.js`; `takeMinPriority` in a new `priorityQueue.js`) carry the ordering logic. The engine's `drainMeshQueue` rebuilds a throttled distance-sorted drain order over the existing `pendingMeshIds` Set (Set stays the source of truth; stale ids are skipped). `useTextureFetch` threads an optional `priority` (= camera distance) through to `netQueue`, whose `_pump` dispatches the nearest queued fetch. Cache hits (GPU/blob/IDB) short-circuit before `netQueue` and are unaffected.

**Tech Stack:** Vue 3 composables, Three.js, IndexedDB caches, `bun test` for unit tests, `vite build` for the build gate.

**Spec:** `docs/superpowers/specs/2026-06-15-near-first-load-design.md`

**Verification commands (used throughout):**
- Unit tests for one file: `bun test <path>`
- Full unit suite: `bun test`
- Build gate: `npm run build:staging`

---

### Task 1: `orderByDistance` pure helper

**Files:**
- Modify: `src/lib/cullPolicy.js` (append a new export)
- Test: `src/__tests__/lib/cullPolicy.test.js` (append a `describe` block)

- [ ] **Step 1: Write the failing test**

Append to `src/__tests__/lib/cullPolicy.test.js`. First add `orderByDistance` to the import on line 2:

```js
import { selectEvictions, selectReloads, groupChildrenByRoot, drawDistanceMayGrow, orderByDistance } from '@/lib/cullPolicy.js'
```

Then append at the end of the file:

```js
describe('orderByDistance', () => {
	it('orders ids ascending by distFn (nearest first)', () => {
		const dist = new Map([[1, 30], [2, 200], [3, 10], [4, 96]])
		expect(orderByDistance([1, 2, 3, 4], id => dist.get(id))).toEqual([3, 1, 4, 2])
	})
	it('ids whose distFn returns Infinity sort last', () => {
		const dist = new Map([[1, Infinity], [2, 5], [3, Infinity], [4, 50]])
		expect(orderByDistance([1, 2, 3, 4], id => dist.get(id))).toEqual([2, 4, 1, 3])
	})
	it('empty → []', () => {
		expect(orderByDistance([], () => 0)).toEqual([])
	})
	it('single id → [id]', () => {
		expect(orderByDistance([7], () => 42)).toEqual([7])
	})
	it('does not mutate the input array', () => {
		const ids = [3, 1, 2]
		orderByDistance(ids, id => id)
		expect(ids).toEqual([3, 1, 2])
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/__tests__/lib/cullPolicy.test.js`
Expected: FAIL — `orderByDistance is not a function` (or `undefined`).

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/cullPolicy.js`:

```js
// Nearest-first ordering of a plain id list (near-first load). The engine owns THREE/camera, so it
// passes a distFn(id)→metres; this module just returns a NEW array sorted ascending (Infinity last).
// Used to drain the mesh-build queue closest-first so the player's surroundings build before far
// objects. Pure + total; the caller's Set stays the source of truth (stale ids are skipped on drain).
export function orderByDistance(ids, distFn) {
	return [...ids].sort((a, b) => distFn(a) - distFn(b))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/__tests__/lib/cullPolicy.test.js`
Expected: PASS — 18 tests pass (13 existing + 5 new).

- [ ] **Step 5: Commit** *(stage + hand to Gene — do not run commit)*

```bash
git add src/lib/cullPolicy.js src/__tests__/lib/cullPolicy.test.js
# Gene commits:  feat(render): orderByDistance helper for near-first
```

---

### Task 2: `takeMinPriority` pure helper

**Files:**
- Create: `src/lib/priorityQueue.js`
- Test: `src/__tests__/lib/priorityQueue.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/lib/priorityQueue.test.js`:

```js
import { describe, it, expect } from 'bun:test'
import { takeMinPriority } from '@/lib/priorityQueue.js'

describe('takeMinPriority', () => {
	it('removes and returns the lowest-priority entry (nearest first)', () => {
		const q = [{ id: 'a', priority: 50 }, { id: 'b', priority: 10 }, { id: 'c', priority: 30 }]
		expect(takeMinPriority(q)).toEqual({ id: 'b', priority: 10 })
		expect(q.map(e => e.id)).toEqual(['a', 'c'])   // b spliced out, order otherwise preserved
	})
	it('ties resolve to the earliest-enqueued (first found)', () => {
		const q = [{ id: 'a', priority: 10 }, { id: 'b', priority: 10 }]
		expect(takeMinPriority(q).id).toBe('a')
	})
	it('Infinity priorities drain last but are still returned when alone', () => {
		const q = [{ id: 'a', priority: Infinity }]
		expect(takeMinPriority(q).id).toBe('a')
		expect(q.length).toBe(0)
	})
	it('empty queue → null', () => {
		expect(takeMinPriority([])).toBe(null)
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/__tests__/lib/priorityQueue.test.js`
Expected: FAIL — cannot find module `@/lib/priorityQueue.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/priorityQueue.js`:

```js
// src/lib/priorityQueue.js — pure min-priority extraction for the texture network queue (near-first
// load). Entries are { run, priority } where smaller priority = nearer = dispatch sooner. The queue
// is a plain array (bounded by the fetcher's slot model); a linear min-scan per freed slot is cheap
// and infrequent. Returns the removed entry, or null when empty. Total + pure (mutates only the array
// it is handed, by design — it IS the dequeue). YAGNI: a binary heap is unnecessary at this depth.
export function takeMinPriority(queue) {
	if (!queue.length) return null
	let minI = 0
	for (let i = 1; i < queue.length; i++) {
		if (queue[i].priority < queue[minI].priority) minI = i
	}
	return queue.splice(minI, 1)[0]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/__tests__/lib/priorityQueue.test.js`
Expected: PASS — 4 tests pass.

- [ ] **Step 5: Commit** *(stage + hand to Gene)*

```bash
git add src/lib/priorityQueue.js src/__tests__/lib/priorityQueue.test.js
# Gene commits:  feat(render): min-priority queue helper for near-first
```

---

### Task 3: Mesh build near-first (engine wiring)

**Files:**
- Modify: `src/composables/useWorldEngine.js` — import (line 23), new state near the `drainMeshQueue` definition, and rewrite `drainMeshQueue` (currently lines 3557–3597).

> No unit test: this is thin glue around the pure `orderByDistance` (Task 1, tested) over a Three.js +
> Pinia composable that the suite does not instantiate. Verified by the build gate + live-verify.

- [ ] **Step 1: Add `orderByDistance` to the cullPolicy import**

Change line 23 of `src/composables/useWorldEngine.js` from:

```js
import { selectEvictions, selectReloads, groupChildrenByRoot, drawDistanceMayGrow } from '@/lib/cullPolicy.js'
```

to:

```js
import { selectEvictions, selectReloads, groupChildrenByRoot, drawDistanceMayGrow, orderByDistance } from '@/lib/cullPolicy.js'
```

- [ ] **Step 2: Add near-first drain-order state**

Insert immediately ABOVE the `function drainMeshQueue() {` line (currently 3557):

```js
	// Near-first drain order (FEATURE-GAPS: near-first load). pendingMeshIds (a Set) stays the
	// source of truth for membership; _drainOrder is a throttled distance-sorted view of it that
	// drainMeshQueue walks so the player's surroundings build BEFORE far objects. Rebuilt only when
	// stale (TTL elapsed, fully drained, or the camera moved enough that "nearest" changed) so the
	// O(n log n) sort runs ~1×/s, never per frame. Stale ids left in the array are skipped on walk.
	let _drainOrder = []
	let _drainCursor = 0
	let _drainOrderAt = 0
	const _drainOrderCam = new THREE.Vector3()
	const DRAIN_ORDER_TTL_MS = 750
	const DRAIN_ORDER_MOVE_M = 8

	function rebuildDrainOrder() {
		_drainOrder = orderByDistance([...pendingMeshIds], (id) => {
			const o = worldStore.objects.get(id)
			return o ? camDistToObj(o) : Infinity   // unknown/killed → sort last (skipped on walk)
		})
		_drainCursor = 0
		_drainOrderAt = performance.now()
		if (camera) _drainOrderCam.copy(camera.position)
	}
```

- [ ] **Step 3: Rewrite `drainMeshQueue` to walk the near-first order**

Replace the entire current `drainMeshQueue` body (lines 3557–3597) with:

```js
	function drainMeshQueue() {
		if (!pendingMeshIds.size) { _dtEmpty++; return }
		// Memory governor: stop baking new geometry while the JS heap is near its limit (each bake adds
		// a BufferGeometry + material). Queued ids stay; the next tick resumes once pressure clears.
		if (memUnderPressure()) { _dtGov++; return }
		_dtTicks++
		const start = performance.now()
		// Hidden tab: Chrome clamps setInterval to ~1Hz, so the 8ms/30ms pacing collapses to 8ms/s and
		// the load crawls exactly while the user is away. No frames to protect when hidden → spend a
		// big budget per (rare) tick instead. Visible tab keeps the small per-frame budget.
		const budget = (typeof document !== 'undefined' && document.hidden) ? 250 : MESH_DRAIN_BUDGET_MS
		// Rebuild the near-first order when stale: exhausted, TTL elapsed, or the camera moved far
		// enough that the existing ordering no longer reflects "nearest from where the player stands".
		const camMoved = camera ? camera.position.distanceTo(_drainOrderCam) : 0
		if (_drainCursor >= _drainOrder.length ||
			performance.now() - _drainOrderAt > DRAIN_ORDER_TTL_MS ||
			camMoved > DRAIN_ORDER_MOVE_M) {
			rebuildDrainOrder()
		}
		while (_drainCursor < _drainOrder.length) {
			// WHY + _geomPending: bake dispatch is deferred behind the async IDB lookup, so deferred
			// entries are future bakes the cap must see — outstanding() alone rises too late on cold load.
			if (meshBaker.outstanding() + _geomPending > BAKE_INFLIGHT_CAP) { _dtBrkCap++; break }   // backpressure: let the worker catch up
			const localId = _drainOrder[_drainCursor++]
			if (!pendingMeshIds.has(localId)) continue   // killed / evicted / already built since the sort
			pendingMeshIds.delete(localId)
			const obj = worldStore.objects.get(localId)
			if (!obj) continue  // killed before its mesh was built
			const t0 = performance.now()
			try {
				upsertMesh(obj)
			} catch (e) {
				upsertMeshFailures++
				if (upsertMeshFailures <= 5 || upsertMeshFailures % 25 === 0) {
					debugStore.push('warn', `[3D] upsertMesh(drain) fail #${upsertMeshFailures} localId=${localId} pcode=${obj.pcode}: ${e.message}`)
				}
			}
			// Throughput probe: per-call upsertMesh cost is the cold-load bottleneck (~30 builds/s on a
			// 31k-prim region). Accumulated here, reported+reset by the 5s asset-stats tick as [Drain].
			const dt = performance.now() - t0
			_drainBuilt++; _drainMs += dt; if (dt > _drainMaxMs) _drainMaxMs = dt
			if (performance.now() - start > budget) { _dtBrkBudget++; break }
		}
		// C1 (perf): once the initial flood has fully drained, precompile shaders off the render
		// path (async, non-blocking where the GPU supports KHR_parallel_shader_compile) so the
		// first camera move doesn't hit a lazy synchronous shader-compile stall (~271ms observed).
		if (pendingMeshIds.size === 0 && !_didPrecompile && meshMap.size > 50 && renderer) {
			_didPrecompile = true
			renderer.compileAsync?.(scene, camera)
		}
	}
```

- [ ] **Step 4: Verify build + full unit suite (no regression)**

Run: `npm run build:staging`
Expected: build completes with no errors.

Run: `bun test`
Expected: all tests pass (same count as baseline + the 9 new from Tasks 1–2; no new failures).

- [ ] **Step 5: Commit** *(stage + hand to Gene)*

```bash
git add src/composables/useWorldEngine.js
# Gene commits:  perf(render): near-first mesh build drain order
```

---

### Task 4: Texture fetch near-first (priority netQueue)

**Files:**
- Modify: `src/composables/useTextureFetch.js` — import (line ~7 area), `_pump` (107), `_wsFetch` (147 + the `netQueue.push` at 190), `getBlob` (222), `getBaseTexture` (283), `getTexture` (348).

> Dispatch logic is the pure `takeMinPriority` (Task 2, tested). The threading is mechanical; verified
> by the build gate + full suite + live-verify.

- [ ] **Step 1: Import the helper**

Add near the other `@/lib` imports at the top of `src/composables/useTextureFetch.js` (e.g. directly under the `textureCache.js` import on line 8):

```js
import { takeMinPriority } from '@/lib/priorityQueue.js'
```

- [ ] **Step 2: `_pump` dispatches nearest-first**

Replace `_pump` (line 107 body) — change the dequeue from FIFO `shift()` to min-priority:

```js
function _pump() {
	while (active < MAX_INFLIGHT && netQueue.length && !(emergencyHeap() || getTextureBytes() > TEX_INTAKE_BUDGET)) {
		active++
		takeMinPriority(netQueue).run()   // nearest queued fetch first (near-first load)
	}
}
```

- [ ] **Step 3: `_wsFetch` accepts + stores priority**

Change the `_wsFetch` signature (line 147) and its `netQueue.push` (line 190).

Signature:

```js
function _wsFetch(uuid, priority = Infinity) {
```

The `netQueue.push(run)` line (190) becomes:

```js
		netQueue.push({ run, priority })   // priority = camera distance; _pump dispatches nearest first
```

(Everything between — the `run` closure, `settle`, timeout — is unchanged.)

- [ ] **Step 4: Thread priority through `getBlob`**

Change `getBlob` (line 222) signature and its `_wsFetch` call (line 232):

Signature:

```js
function getBlob(uuid, priority = Infinity) {
```

The network call (line 232) becomes:

```js
		const net = await _wsFetch(uuid, priority)               // server fetch + transcode (sets alphaCache)
```

(Cache-hit branches above it — `blobCache.has`, `texCacheGet` — are unchanged; they never reach `_wsFetch`, so cached textures still bypass the priority queue entirely.)

- [ ] **Step 5: Thread priority through `getBaseTexture`**

Change `getBaseTexture` (line 283) signature and its `getBlob` call (line 289):

Signature:

```js
function getBaseTexture(uuid, priority = Infinity) {
```

The `getBlob` call (line 289) becomes:

```js
	const p = getBlob(uuid, priority).then(blob => {
```

(The `cache.has(uuid)` and `texInflight.has(uuid)` short-circuits above are unchanged — resident textures return with no fetch.)

- [ ] **Step 6: Thread priority through the public `getTexture`**

Change `getTexture` (line 348) signature and its `getBaseTexture` call (line 350):

Signature:

```js
export function getTexture(uuid, xform = null, priority = Infinity) {
```

The base call (line 350) becomes:

```js
	const baseP = getBaseTexture(uuid, priority)
```

(The xform-clone branch below is unchanged.)

- [ ] **Step 7: Verify build + full unit suite**

Run: `npm run build:staging`
Expected: build completes with no errors.

Run: `bun test`
Expected: all tests pass, no new failures.

- [ ] **Step 8: Commit** *(stage + hand to Gene)*

```bash
git add src/composables/useTextureFetch.js
# Gene commits:  perf(render): priority texture fetch queue (near-first)
```

---

### Task 5: Pass camera distance at the prim/mesh texture call sites

**Files:**
- Modify: `src/composables/useWorldEngine.js` — five `getTexture(...)` call sites (current lines 2084, 2124, 2140, 3694, 3773). `camDistToObj` and `obj` are in scope at each (camDistToObj is a hoisted composable function; obj is the local/param being textured).

> Terrain texture loads (`getTexture(r.uuid)` ~line 1423) are intentionally LEFT at the default
> `Infinity` priority — distance to a terrain detail texture is not meaningful and there are only ~4.

- [ ] **Step 1: Prim diffuse (line 2084)**

Change:

```js
				getTexture(primTexId, xform).then(tex => {
```

to:

```js
				getTexture(primTexId, xform, camDistToObj(obj)).then(tex => {
```

- [ ] **Step 2: PBR maps — the `setMap` helper (line 2124)**

Change:

```js
					const setMap = (uuid, slot, srgb) => uuid && getTexture(uuid).then(t => {
```

to:

```js
					const setMap = (uuid, slot, srgb) => uuid && getTexture(uuid, null, camDistToObj(obj)).then(t => {
```

- [ ] **Step 3: Legacy material normalMap (line 2140)**

Change:

```js
						if (m.normMap) getTexture(m.normMap).then(t => { if (t && mesh.material === mat && mat.isMeshStandardMaterial) { mat.normalMap = t; mat.needsUpdate = true } })
```

to:

```js
						if (m.normMap) getTexture(m.normMap, null, camDistToObj(obj)).then(t => { if (t && mesh.material === mat && mat.isMeshStandardMaterial) { mat.normalMap = t; mat.needsUpdate = true } })
```

- [ ] **Step 4: Per-face texture (line 3694)**

Change:

```js
				getTexture(faceTex, faceXform(i)).then(tex => {
```

to:

```js
				getTexture(faceTex, faceXform(i), camDistToObj(obj)).then(tex => {
```

- [ ] **Step 5: Backfill re-apply — `reapplyDiffuse` (line 3773)**

Change:

```js
		getTexture(texId, xform).then(tex => {
```

to:

```js
		getTexture(texId, xform, camDistToObj(obj)).then(tex => {
```

- [ ] **Step 6: Verify build + full unit suite**

Run: `npm run build:staging`
Expected: build completes with no errors.

Run: `bun test`
Expected: all tests pass, no new failures.

- [ ] **Step 7: Commit** *(stage + hand to Gene)*

```bash
git add src/composables/useWorldEngine.js
# Gene commits:  perf(render): pass camera distance to texture fetches
```

---

### Task 6: Live-verify on a heavy region

> Not automatable here — this is the real acceptance gate (the suite + build only prove no regression).

- [ ] **Step 1:** With Vite (Gene, 5174) + Bun WS (8787) running, TP/cold-load into a heavy region.
- [ ] **Step 2:** Watch the scene around the avatar: near objects should **build and texture first**, far ones fill in after — visibly nearest-out, not arrival-order.
- [ ] **Step 3:** Watch the `[Drain]` / `[Mem]` console lines for any `[Slow]` drain-tick regression (the throttled sort should not appear). If a drain-tick `[Slow]` shows up, switch `orderByDistance` to radial bucketing (the spec's documented fallback) — do NOT remove the throttle.
- [ ] **Step 4:** Confirm warm revisit still behaves (near builds first there too — the build ceiling applies to cached objects).
- [ ] **Step 5:** Update `docs/render-cache-model.md` (Next-work #1) + `docs/FEATURE-GAPS.md` with the measured result, and the relevant memory file. *(Gene commits.)*

---

## Self-Review

**Spec coverage:**
- Mesh build near-first → Tasks 1 + 3. ✓
- Texture fetch near-first (priority netQueue, Option B) → Tasks 2 + 4 + 5. ✓
- Cache hits bypass the download queue (in/out-of-scope boundary) → preserved by leaving the `cache.has`/`blobCache.has`/`texCacheGet` short-circuits untouched (Task 4 Steps 4–5 notes). ✓
- `camDistToObj` reference point → used in Tasks 3 + 5. ✓
- TTL / move-threshold / exhausted rebuild triggers → Task 3 Step 3. ✓
- Default `priority = Infinity` for non-distance callers (terrain) → Task 4 signatures + Task 5 terrain note. ✓
- Non-goals (eviction/badge/LOD) → untouched. ✓

**Placeholder scan:** none — every code step shows complete code; every command shows expected output.

**Type/signature consistency:** `orderByDistance(ids, distFn)` defined Task 1, called Task 3. `takeMinPriority(queue)` defined Task 2, called Task 4 Step 2. `getTexture(uuid, xform, priority)` signature (Task 4 Step 6) matches all five call sites (Task 5) and the `getBaseTexture`/`getBlob`/`_wsFetch` chain (Task 4 Steps 3–5). `netQueue` entry shape `{ run, priority }` written in `_wsFetch` (Step 3) and consumed by `takeMinPriority` (`.priority`) + `_pump` (`.run()`) consistently.
