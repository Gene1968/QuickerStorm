# Worker Mesh Bake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move prim-shape and mesh/sculpt geometry baking off the main thread into a Web Worker so region fill is no longer throttled by vertex generation competing with the render loop.

**Architecture:** Extract the pure geometry-bake functions into a shared `src/lib/primGeometry.js` imported by both the engine (synchronous fallback) and a new module worker. The worker bakes geometry to transferable typed arrays; `useWorldEngine` shows a cheap placeholder cube immediately and hot-swaps the baked geometry in on worker reply — extending the async hot-swap pattern mesh/sculpt prims already use.

**Tech Stack:** Three.js, Vite module workers (`new Worker(new URL(...), {type:'module'})`), Vitest (jsdom), Vue composition API.

**Spec:** `docs/superpowers/specs/2026-06-07-worker-mesh-bake-design.md`

**Test command:** `npx vitest run <path>` (no `test` npm script; vitest config at `vitest.config.js`).

**Commit policy:** This repo's owner commits manually ([[never-auto-commit]]). The "Commit" steps below stage and write a commit ONLY if the user has explicitly authorized commits for this work; otherwise stop at the passing-test step and leave changes staged-unstaged for the user. Do not auto-commit.

---

## File Structure

- Create: `src/lib/primGeometry.js` — pure geometry bake fns + array (de)serialization. Imports THREE. Single source of truth.
- Create: `src/workers/meshBake.worker.js` — module worker; imports primGeometry.js; batched job handler.
- Create: `src/composables/useMeshBaker.js` — worker dispatcher; batching, id→promise routing, sync fallback, teardown.
- Create: `src/__tests__/lib/primGeometry.test.js` — roundtrip + behavior tests.
- Create: `src/__tests__/composables/useMeshBaker.test.js` — fallback-path test.
- Modify: `src/composables/useWorldEngine.js` — remove local geometry fns (import from lib); wire baker into `upsertMesh` prim + mesh/sculpt paths; teardown worker on unmount.

---

## Task 1: Extract shared geometry module

**Files:**
- Create: `src/lib/primGeometry.js`
- Modify: `src/composables/useWorldEngine.js` (remove local defs at lines 55-84, 86-103, 111-149, 156-159, 166-171; import from lib)
- Test: `src/__tests__/lib/primGeometry.test.js`

- [ ] **Step 1: Create `src/lib/primGeometry.js` with the moved functions + new array helpers**

Move these verbatim from `useWorldEngine.js` (keep their `// WHY` comments): `swapSubmeshesToGeometry`, `buildPrimGeometry`, `applyShapeDeformation`, `bakePrimScale`, `geometryHasFiniteVerts`. Add `extractGeomArrays` and `geometryFromArrays`. Full file:

```js
import * as THREE from 'three'

// ── (moved verbatim from useWorldEngine.js — see git history for WHY comments) ──
// buildPrimGeometry, applyShapeDeformation, bakePrimScale, swapSubmeshesToGeometry,
// geometryHasFiniteVerts are moved here UNCHANGED. Paste their exact bodies below.

export function applyShapeDeformation(geom, shape) { /* exact body from useWorldEngine.js:111-149 */ }
export function buildPrimGeometry(shape)           { /* exact body from useWorldEngine.js:86-103 */ }
export function bakePrimScale(geom, scale)         { /* exact body from useWorldEngine.js:156-159 */ }
export function swapSubmeshesToGeometry(subs, scale) { /* exact body from useWorldEngine.js:55-84 */ }
export function geometryHasFiniteVerts(geom)       { /* exact body from useWorldEngine.js:166-171 */ }

// Extract a baked BufferGeometry into plain transferable arrays for postMessage.
// Returns null attributes as undefined so geometryFromArrays can skip them.
export function extractGeomArrays(geom) {
	const pos = geom.attributes.position
	const nor = geom.attributes.normal
	const uv  = geom.attributes.uv
	const idx = geom.index
	return {
		position: pos ? pos.array : undefined,
		normal:   nor ? nor.array : undefined,
		uv:       uv  ? uv.array  : undefined,
		index:    idx ? idx.array : undefined,
		groups:   geom.groups.map(g => ({ start: g.start, count: g.count, materialIndex: g.materialIndex })),
	}
}

// Rebuild a BufferGeometry from extractGeomArrays output (cheap — no per-vertex loop).
export function geometryFromArrays(a) {
	const g = new THREE.BufferGeometry()
	if (a.position) g.setAttribute('position', new THREE.BufferAttribute(a.position, 3))
	if (a.normal)   g.setAttribute('normal',   new THREE.BufferAttribute(a.normal, 3))
	if (a.uv)       g.setAttribute('uv',       new THREE.BufferAttribute(a.uv, 2))
	if (a.index)    g.setIndex(new THREE.BufferAttribute(a.index, 1))
	if (a.groups) for (const grp of a.groups) g.addGroup(grp.start, grp.count, grp.materialIndex)
	return g
}

// Bake a single job to plain arrays (shared by worker and the sync fallback).
// job: { kind:'prim', shape, scale } | { kind:'submesh', subs, scale }
export function bakeJob(job) {
	const geom = job.kind === 'submesh'
		? swapSubmeshesToGeometry(job.subs, job.scale)
		: bakePrimScale(buildPrimGeometry(job.shape), job.scale)
	if (!geometryHasFiniteVerts(geom)) { geom.dispose?.(); return { bad: true } }
	const arrays = extractGeomArrays(geom)
	geom.dispose?.()
	return arrays
}
```

- [ ] **Step 2: Write failing tests**

`src/__tests__/lib/primGeometry.test.js`:

```js
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import {
	buildPrimGeometry, bakePrimScale, geometryHasFiniteVerts,
	extractGeomArrays, geometryFromArrays, bakeJob,
} from '@/lib/primGeometry.js'

describe('primGeometry', () => {
	it('builds finite box geometry for a default shape', () => {
		const g = bakePrimScale(buildPrimGeometry({ pathCurve: 16, profileCurve: 1 }), [2, 3, 4])
		expect(geometryHasFiniteVerts(g)).toBe(true)
		// bakePrimScale maps Three (x=sx, y=sz, z=sy): scale [2,3,4] → geom.scale(2,4,3)
		g.computeBoundingBox()
		const size = new THREE.Vector3()
		g.boundingBox.getSize(size)
		expect(size.x).toBeCloseTo(2, 5)
		expect(size.y).toBeCloseTo(4, 5)
		expect(size.z).toBeCloseTo(3, 5)
	})

	it('extract → geometryFromArrays roundtrips position/index/groups', () => {
		const subs = [{
			positions: [0,0,0, 1,0,0, 0,1,0],
			normals:   [0,0,1, 0,0,1, 0,0,1],
			uvs:       [0,0, 1,0, 0,1],
			indices:   [0,1,2],
		}]
		const arrays = bakeJob({ kind: 'submesh', subs, scale: [1,1,1] })
		const g = geometryFromArrays(arrays)
		expect(g.attributes.position.count).toBe(3)
		expect(Array.from(g.index.array)).toEqual([0,1,2])
		expect(g.groups.length).toBe(1)
		expect(g.groups[0]).toMatchObject({ start: 0, count: 3, materialIndex: 0 })
	})

	it('bakeJob flags non-finite geometry as bad instead of returning arrays', () => {
		const subs = [{ positions: [NaN,0,0, 1,0,0, 0,1,0], normals:[0,0,1,0,0,1,0,0,1], uvs:[0,0,1,0,0,1], indices:[0,1,2] }]
		expect(bakeJob({ kind: 'submesh', subs, scale: [1,1,1] })).toEqual({ bad: true })
	})
})
```

- [ ] **Step 3: Run tests, verify they pass** (extraction is behavior-preserving; these assert the moved code + new helpers)

Run: `npx vitest run src/__tests__/lib/primGeometry.test.js`
Expected: 3 passed. If the box-size assertion fails, re-check the axis map in the moved `bakePrimScale` matches the original (`geom.scale(scale[0], scale[2], scale[1])`).

- [ ] **Step 4: Update `useWorldEngine.js` to import from the lib and delete the local copies**

At top of `useWorldEngine.js` (near the existing THREE import) add:

```js
import {
	buildPrimGeometry, bakePrimScale, swapSubmeshesToGeometry,
	geometryHasFiniteVerts, geometryFromArrays,
} from '@/lib/primGeometry.js'
```

Delete the now-duplicated local function definitions (`buildPrimGeometry`, `applyShapeDeformation`, `bakePrimScale`, `swapSubmeshesToGeometry`, `geometryHasFiniteVerts`) from `useWorldEngine.js`. Leave everything else (including `slQuatToThree`, console-forwarder, etc.) in place. `applyShapeDeformation` is only called by `buildPrimGeometry`, so it does not need a separate import.

- [ ] **Step 5: Run the full existing suite + build to confirm no regression**

Run: `npx vitest run`
Expected: all previously-green tests still pass (notably `src/__tests__/composables/linksetChildScale.test.js`).
Run: `npm run build:staging`
Expected: build succeeds.

- [ ] **Step 6: Commit** (only if commits authorized — see Commit policy)

```bash
git add src/lib/primGeometry.js src/__tests__/lib/primGeometry.test.js src/composables/useWorldEngine.js
git commit -m "refactor(render): extract prim geometry bake to shared lib/primGeometry.js"
```

---

## Task 2: Mesh-bake worker

**Files:**
- Create: `src/workers/meshBake.worker.js`

- [ ] **Step 1: Create the worker**

```js
// Module worker: bakes prim/submesh geometry off the main thread.
// Receives a batch: { batchId, jobs: [{ id, kind, shape?, scale, subs? }] }
// Replies:          { batchId, results: [{ id, ...arrays } | { id, bad:true }] }
// Output array buffers are transferred (zero-copy). Inputs are structured-cloned
// (NOT transferred) — submesh `subs` are shared main-thread cache arrays.
import { bakeJob } from '@/lib/primGeometry.js'

self.onmessage = (e) => {
	const { batchId, jobs } = e.data
	const results = []
	const transfer = []
	for (const job of jobs) {
		let out
		try {
			out = bakeJob(job)
		} catch (err) {
			out = { bad: true, error: String(err && err.message || err) }
		}
		out.id = job.id
		results.push(out)
		if (!out.bad) {
			if (out.position) transfer.push(out.position.buffer)
			if (out.normal)   transfer.push(out.normal.buffer)
			if (out.uv)       transfer.push(out.uv.buffer)
			if (out.index)    transfer.push(out.index.buffer)
		}
	}
	self.postMessage({ batchId, results }, transfer)
}
```

- [ ] **Step 2: Verify it bundles** (no direct unit test — jsdom has no Worker; logic is `bakeJob`, covered in Task 1)

Run: `npm run build:staging`
Expected: build succeeds and emits a worker chunk (Vite detects `new Worker(new URL(...))` in Task 3). At this step the worker is not yet referenced, so just confirm no syntax/import error by building after Task 3. Skip standalone build here.

- [ ] **Step 3: Commit** (only if commits authorized)

```bash
git add src/workers/meshBake.worker.js
git commit -m "feat(render): add mesh-bake module worker"
```

---

## Task 3: Baker dispatcher with sync fallback

**Files:**
- Create: `src/composables/useMeshBaker.js`
- Test: `src/__tests__/composables/useMeshBaker.test.js`

- [ ] **Step 1: Create the dispatcher**

```js
import { bakeJob } from '@/lib/primGeometry.js'

// Dispatches geometry bakes to a module worker, batching all jobs submitted within a
// microtask-flush window into one postMessage. Falls back to synchronous in-thread baking
// if the worker can't be constructed (no module-worker support, CSP, test env).
//
// bake(job) → Promise<arrays | { bad:true }>   job: { kind, shape?, scale, subs? }
export function useMeshBaker() {
	let worker = null
	let dead = false
	let nextId = 1
	let nextBatch = 1
	const pending = new Map()       // jobId → { resolve }
	let queue = []                  // jobs awaiting the next flush
	let flushScheduled = false

	function initWorker() {
		if (worker || dead) return
		try {
			worker = new Worker(new URL('../workers/meshBake.worker.js', import.meta.url), { type: 'module' })
			worker.onmessage = (e) => {
				for (const r of e.data.results) {
					const p = pending.get(r.id)
					if (!p) continue
					pending.delete(r.id)
					const { id, ...out } = r
					p.resolve(out)
				}
			}
			worker.onerror = () => killWorker()
			worker.onmessageerror = () => killWorker()
		} catch {
			dead = true
			worker = null
		}
	}

	// Worker failed: tear it down and resolve everything still pending via the sync fallback.
	function killWorker() {
		dead = true
		try { worker && worker.terminate() } catch { /* ignore */ }
		worker = null
		for (const [, p] of pending) p.resolveSync()
		pending.clear()
		queue = []
	}

	function flush() {
		flushScheduled = false
		if (!queue.length) return
		initWorker()
		const jobs = queue
		queue = []
		if (dead || !worker) {            // sync fallback
			for (const j of jobs) {
				const p = pending.get(j.id)
				pending.delete(j.id)
				p && p.resolve(syncBake(j))
			}
			return
		}
		worker.postMessage({ batchId: nextBatch++, jobs })
	}

	function syncBake(job) {
		try { return bakeJob(job) } catch { return { bad: true } }
	}

	function bake(job) {
		const id = nextId++
		job.id = id
		return new Promise((resolve) => {
			pending.set(id, { resolve, resolveSync: () => resolve(syncBake(job)) })
			queue.push(job)
			if (!flushScheduled) { flushScheduled = true; queueMicrotask(flush) }
		})
	}

	function dispose() {
		try { worker && worker.terminate() } catch { /* ignore */ }
		worker = null
		dead = true
		for (const [, p] of pending) p.resolveSync()
		pending.clear()
		queue = []
	}

	return { bake, dispose }
}
```

- [ ] **Step 2: Write failing test (fallback path — jsdom Worker throws or is absent)**

`src/__tests__/composables/useMeshBaker.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest'
import { useMeshBaker } from '@/composables/useMeshBaker.js'

// jsdom: constructing a module Worker from a file URL throws → exercises the sync fallback.
describe('useMeshBaker (fallback)', () => {
	let baker
	beforeEach(() => { baker = useMeshBaker() })

	it('bakes a prim synchronously when the worker is unavailable', async () => {
		const out = await baker.bake({ kind: 'prim', shape: { pathCurve: 16, profileCurve: 1 }, scale: [1,1,1] })
		expect(out.bad).toBeUndefined()
		expect(out.position).toBeInstanceOf(Float32Array)
		expect(out.position.length).toBeGreaterThan(0)
		baker.dispose()
	})

	it('flags non-finite submesh as bad', async () => {
		const subs = [{ positions:[NaN,0,0,1,0,0,0,1,0], normals:[0,0,1,0,0,1,0,0,1], uvs:[0,0,1,0,0,1], indices:[0,1,2] }]
		const out = await baker.bake({ kind: 'submesh', subs, scale: [1,1,1] })
		expect(out).toEqual({ bad: true })
		baker.dispose()
	})

	it('batches multiple bakes in one flush and resolves each', async () => {
		const results = await Promise.all([
			baker.bake({ kind: 'prim', shape: { pathCurve: 16, profileCurve: 5 }, scale: [1,1,1] }),
			baker.bake({ kind: 'prim', shape: { pathCurve: 32, profileCurve: 5 }, scale: [1,1,1] }),
		])
		expect(results).toHaveLength(2)
		results.forEach(r => expect(r.position).toBeInstanceOf(Float32Array))
		baker.dispose()
	})
})
```

- [ ] **Step 3: Run tests, verify they pass**

Run: `npx vitest run src/__tests__/composables/useMeshBaker.test.js`
Expected: 3 passed. If jsdom does NOT throw on `new Worker(...)` (resolves to a non-functional worker that never replies), the promises will hang and the test will time out — in that case change `initWorker` to feature-detect: wrap construction so any environment where `import.meta.url` worker URL can't load routes to fallback. (jsdom in vitest 4 throws on Worker construction from a file URL; the catch handles it.)

- [ ] **Step 4: Commit** (only if commits authorized)

```bash
git add src/composables/useMeshBaker.js src/__tests__/composables/useMeshBaker.test.js
git commit -m "feat(render): add useMeshBaker dispatcher with sync fallback"
```

---

## Task 4: Wire baker into useWorldEngine.upsertMesh

**Files:**
- Modify: `src/composables/useWorldEngine.js` (`upsertMesh` ~1429-1531; `getMesh`/`getSculpt` `applyDecoded` ~1518-1531; unmount teardown ~2921; import + baker instance near other composable setup ~245)

- [ ] **Step 1: Instantiate the baker**

Near the other composable hookups (e.g. after `const { on, off, emit } = useRealtimeSocket()` around line 245), add the import at top and the instance:

```js
import { useMeshBaker } from '@/composables/useMeshBaker.js'
// ...inside useWorldEngine():
const meshBaker = useMeshBaker()
```

Add `geometryFromArrays` to the existing `@/lib/primGeometry.js` import (added in Task 1) if not already present.

- [ ] **Step 2: Replace the prim geometry build with placeholder + async swap**

In `upsertMesh`, the `isNew` branch currently builds the real geometry synchronously:

```js
let geo = isAvatar
	? new THREE.CapsuleGeometry(0.33, 0.96, 4, 8)
	: bakePrimScale(buildPrimGeometry(obj.shape), obj.scale)
```

Replace the prim (`!isAvatar`) case with a cheap unit cube baked to scale, and queue the real bake. Keep the avatar case exactly as-is. After `mesh = new THREE.Mesh(geo, mat)` is created (line ~1501) and AFTER the material/alpha setup, but using the SAME `applyDecoded` swap helper defined just below, add the prim bake. Concretely:

```js
// Prim shape: show a cheap unit cube immediately (instant, non-blocking), bake the real
// geometry in the worker, hot-swap on reply. Box prims swap cube→box invisibly. Mesh/sculpt
// prims still fetch their asset first (below), then bake its submeshes via the same worker.
let geo = isAvatar
	? new THREE.CapsuleGeometry(0.33, 0.96, 4, 8)
	: bakePrimScale(new THREE.BoxGeometry(1, 1, 1), obj.scale)
// (drop the inline buildPrimGeometry/NaN-guard for prims; the worker bake + applyDecoded handle it)
```

Keep the existing `geoBad`/NaN-guard ONLY for the avatar-impossible degenerate case is unnecessary now for prims (worker returns `bad`); leave the avatar path untouched. The unit-cube placeholder always has finite verts, so the synchronous `geometryHasFiniteVerts` guard block can be skipped for the prim case (it ran on the now-removed inline geometry). Leave the block guarded by `if (!isAvatar && !geometryHasFiniteVerts(geo))` — for a unit cube it is always false, so it is a harmless no-op; do not delete it (avoids touching avatar logic).

- [ ] **Step 3: Generalize `applyDecoded` and add the prim bake call**

The existing `applyDecoded` (lines ~1518-1526) takes decoded `subs` and calls `swapSubmeshesToGeometry` on the main thread. Change it to accept worker-baked arrays, and route both prim shapes and mesh/sculpt through the baker. Replace the `applyDecoded` definition and the mesh/sculpt fetch block (~1518-1531) with:

```js
// Hot-swap baked geometry (from the worker, or sync fallback) onto the live mesh.
const applySwap = (out) => {
	if (!out || out.bad || !mesh.parent || mesh.material !== mat) {
		if (out && out.bad) geoNaNCount++   // keep the placeholder cube
		return
	}
	const baked = geometryFromArrays(out)
	if (!geometryHasFiniteVerts(baked)) { baked.dispose?.(); geoNaNCount++; return }
	const old = mesh.geometry
	mesh.geometry = baked
	old.dispose()
}

if (!isAvatar && !obj._placeholder && obj.meshId) {
	getMesh(obj.meshId).then(subs => {
		if (!subs || !subs.length) return
		return meshBaker.bake({ kind: 'submesh', subs, scale: obj.scale }).then(applySwap)
	})
} else if (!isAvatar && !obj._placeholder && obj.sculptId) {
	getSculpt(obj.sculptId, obj.sculptType ?? 1).then(subs => {
		if (!subs || !subs.length) return
		return meshBaker.bake({ kind: 'submesh', subs, scale: obj.scale }).then(applySwap)
	})
} else if (!isAvatar && !obj._placeholder) {
	// plain prim shape → bake real geometry off-thread, swap over the placeholder cube
	meshBaker.bake({ kind: 'prim', shape: obj.shape, scale: obj.scale }).then(applySwap)
}
```

NOTE: the `hasMaterial && !geo.attributes.normal` `computeVertexNormals()` call at line ~1500 runs on the placeholder cube (which has normals) — harmless. The baked geometry from the worker already carries normals (`buildPrimGeometry`/`swapSubmeshesToGeometry` produce them), so lit materials shade correctly after `applySwap`. If a lit prim ever lacks normals post-swap, add `if (hasMaterial && !baked.attributes.normal) baked.computeVertexNormals()` inside `applySwap` before the swap.

- [ ] **Step 4: Tear down the worker on unmount**

In the unmount/cleanup path (near line ~2921 where `orphansByParent.clear()` runs and timers are cleared), add:

```js
meshBaker.dispose()
```

- [ ] **Step 5: Run full suite + build**

Run: `npx vitest run`
Expected: all green (no engine unit tests exercise the worker path directly; this confirms no import/parse regressions).
Run: `npm run build:staging`
Expected: build succeeds; Vite emits a separate worker chunk (look for a `meshBake.worker-*.js` asset in build output).

- [ ] **Step 6: Commit** (only if commits authorized)

```bash
git add src/composables/useWorldEngine.js
git commit -m "feat(render): bake prim + mesh/sculpt geometry in worker, placeholder-then-swap"
```

---

## Task 5: Live verification (manual — user-driven)

**Not a code task.** After build, the repo owner runs the app against a heavy region and observes:

- [ ] **Step 1:** Restart `npm run dev:server` (--watch unreliable on Windows, [[server-log-location]]) and `npm run dev`; hard-reload the client.
- [ ] **Step 2:** Log into a 20k+ prim region. Watch the `[Assets]` / build-rate telemetry already in `useWorldEngine`. Compare prims-built/sec against the ~37/sec baseline.
- [ ] **Step 3:** Confirm: no "cube field that never morphs" (swaps complete), no NaN/radius console spam regression, scene fills meaningfully faster, frame rate during fill is smoother (bake no longer on main thread).
- [ ] **Step 4:** If throughput barely moved, the bottleneck is scene-graph insert / draw-call count, not bake — record that in `[[render-pipeline-state]]` and open the geometry-instancing spec (separate work).

---

## Self-Review notes

- **Spec coverage:** shared module (Task 1), worker (Task 2), dispatcher+fallback (Task 3), engine wiring incl. placeholder/hot-swap/transferable-input rules (Task 4), testing (Tasks 1&3), live-verify risk check (Task 5). All spec sections mapped.
- **Type consistency:** `bake(job)` returns `arrays | {bad:true}`; `applySwap` consumes the same shape; `extractGeomArrays`/`geometryFromArrays` use identical key names (`position/normal/uv/index/groups`). Worker reply key is `results` (array of `{id, ...arrays}`), routed by `id` in the dispatcher.
- **Transferable rule:** worker transfers OUTPUT buffers only; `subs` inputs are structured-cloned (no transfer list), preserving the shared mesh cache — matches spec.
