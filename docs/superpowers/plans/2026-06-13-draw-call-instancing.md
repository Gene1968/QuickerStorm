# Draw-Call Instancing (FEATURE-GAPS #6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render repeated scene geometry through `THREE.InstancedMesh` instead of one `THREE.Mesh` per object, cutting steady-state draw calls ~5–7× (17,373 → ~2,500–3,500) and collapsing duplicated VRAM.

**Architecture:** Instancing is a *post-settle migration layer* bolted onto the existing per-object mesh pipeline — `upsertMesh` is untouched. Three isolated, GL-free lib modules (`geomParts`, `instanceKey`, `instancePool`) do the heavy lifting and are unit-tested under jsdom. `useWorldEngine.js` orchestrates: a migrate-in pass folds settled meshes into pools, a promote-out pass pulls them back when they go dynamic, and `cullTick`/picking/memory-stats learn about pools. Everything is behind a Prefs flag, default OFF.

**Tech Stack:** Vue 3 `<script setup>`, Pinia, Three.js 0.183, Vitest (jsdom), tabs (not spaces).

**Spec:** `docs/superpowers/specs/2026-06-13-draw-call-instancing-design.md`

**Conventions:** Tabs for indentation. `@/` = `src/`. Tests in `src/__tests__/lib/`. Run a single test file with `npx vitest run src/__tests__/lib/<file>`. ESLint is broken repo-wide (flat-config) — verify via `npx vitest run` + `npm run build:staging`, NOT lint. NEVER auto-commit unless the executor is told to; commit subjects ≤50 chars.

---

## File Structure

| File | Responsibility | Status |
|------|----------------|--------|
| `src/lib/geomParts.js` | Split a baked `BufferGeometry` into one compacted sub-geometry per `materialIndex` group. Pure. | Create |
| `src/lib/instanceKey.js` | Derive a stable `materialKey` string (everything that determines a Material *except color*). Pure. | Create |
| `src/lib/instancePool.js` | Own the `InstancedMesh` objects: add/remove (swap-remove), grow, pick, byte-accounting. No texture knowledge — caller supplies a geometry+material factory. | Create |
| `src/__tests__/lib/geomParts.test.js` | Group-slicing correctness. | Create |
| `src/__tests__/lib/instanceKey.test.js` | Determinism + color-exclusion. | Create |
| `src/__tests__/lib/instancePool.test.js` | add / remove / swap-remove / grow / pick / bytes / empty-dispose. | Create |
| `src/stores/uiStore.js` | Add `instancing` boolean flag (persisted, default false). | Modify |
| `src/composables/useWorldEngine.js` | Orchestration: settle tracking, migrate-in pass, promote-out, cull integration, raycast picking, memory stats, relight. | Modify |
| `src/components/PreferencesFloater.vue` | Add the Prefs▸Graphics toggle. | Modify |

---

## Phase 1 — Isolated lib modules (TDD, no GL context)

### Task 1: `geomParts.js` — split geometry by material group

**Files:**
- Create: `src/lib/geomParts.js`
- Test: `src/__tests__/lib/geomParts.test.js`

A baked `BufferGeometry` carries `groups` (`[{start,count,materialIndex}]`). A single-material geometry has 0 or 1 group → one part (the whole geometry). A multi-material geometry → one compacted sub-geometry per distinct `materialIndex`. Compaction (re-index only the referenced vertices) keeps each part independent — no shared attribute buffers, so disposal is hazard-free.

- [ ] **Step 1: Write the failing test**

```js
// src/__tests__/lib/geomParts.test.js
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { splitParts } from '@/lib/geomParts.js'

// Build an indexed geometry: 2 quads (8 verts, 12 indices), two material groups.
function twoGroupGeom() {
	const g = new THREE.BufferGeometry()
	const pos = []
	for (let q = 0; q < 2; q++) {
		const z = q
		pos.push(0,0,z, 1,0,z, 1,1,z, 0,1,z)
	}
	g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
	g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(16).fill(0), 2))
	// quad 0 → verts 0..3, quad 1 → verts 4..7
	g.setIndex([0,1,2, 0,2,3,  4,5,6, 4,6,7])
	g.addGroup(0, 6, 0)   // first quad → materialIndex 0
	g.addGroup(6, 6, 7)   // second quad → materialIndex 7 (SL face index, non-contiguous)
	return g
}

describe('splitParts', () => {
	it('returns one part for single-group geometry', () => {
		const g = new THREE.BoxGeometry(1, 1, 1)   // no groups
		const parts = splitParts(g)
		expect(parts).toHaveLength(1)
		expect(parts[0].materialIndex).toBe(0)
		expect(parts[0].geometry).toBe(g)   // passthrough, not copied
	})

	it('splits multi-group geometry into one compacted part per materialIndex', () => {
		const parts = splitParts(twoGroupGeom())
		expect(parts).toHaveLength(2)
		expect(parts.map(p => p.materialIndex).sort((a, b) => a - b)).toEqual([0, 7])
		for (const p of parts) {
			// each part = one quad = 4 compacted verts, 6 indices
			expect(p.geometry.getAttribute('position').count).toBe(4)
			expect(p.geometry.getIndex().count).toBe(6)
			expect(p.geometry.getAttribute('uv')).toBeTruthy()
		}
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/lib/geomParts.test.js`
Expected: FAIL — `splitParts` is not exported / module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// src/lib/geomParts.js
import * as THREE from 'three'

// Split a baked BufferGeometry into one sub-geometry per material group, so each
// face-group can be rendered by its own InstancedMesh (InstancedMesh takes a single
// material, not a material array). Single-group geometry passes through unchanged.
// Each multi-group part is COMPACTED (only its referenced vertices, re-indexed) so
// parts share no attribute buffers — disposal is independent and hazard-free.
// WHY: per-face material arrays are ~48% of draw calls; decomposing them is the
// only way to instance multi-material mesh assets. See spec draw-call-instancing.
export function splitParts(geometry) {
	const groups = geometry.groups
	if (!groups || groups.length <= 1) {
		return [{ materialIndex: groups?.[0]?.materialIndex ?? 0, geometry }]
	}
	// A materialIndex may span several non-contiguous index ranges — merge them.
	const ranges = new Map()
	for (const g of groups) {
		if (!ranges.has(g.materialIndex)) ranges.set(g.materialIndex, [])
		ranges.get(g.materialIndex).push([g.start, g.count])
	}
	const parts = []
	for (const [materialIndex, rs] of ranges) {
		parts.push({ materialIndex, geometry: compact(geometry, rs) })
	}
	return parts
}

function compact(src, ranges) {
	const pos = src.getAttribute('position')
	const nor = src.getAttribute('normal')
	const uv = src.getAttribute('uv')
	const srcIdx = src.getIndex().array
	const remap = new Map()
	const nPos = [], nNor = [], nUv = [], nIdx = []
	for (const [start, count] of ranges) {
		for (let i = start; i < start + count; i++) {
			const vi = srcIdx[i]
			let ni = remap.get(vi)
			if (ni === undefined) {
				ni = remap.size
				remap.set(vi, ni)
				nPos.push(pos.getX(vi), pos.getY(vi), pos.getZ(vi))
				if (nor) nNor.push(nor.getX(vi), nor.getY(vi), nor.getZ(vi))
				if (uv) nUv.push(uv.getX(vi), uv.getY(vi))
			}
			nIdx.push(ni)
		}
	}
	const g = new THREE.BufferGeometry()
	g.setAttribute('position', new THREE.Float32BufferAttribute(nPos, 3))
	if (nor) g.setAttribute('normal', new THREE.Float32BufferAttribute(nNor, 3))
	if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(nUv, 2))
	g.setIndex(nIdx)
	g.computeBoundingSphere()
	return g
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/lib/geomParts.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/geomParts.js src/__tests__/lib/geomParts.test.js
git commit -m "feat(instancing): geometry part splitter"
```

---

### Task 2: `instanceKey.js` — material pooling key

**Files:**
- Create: `src/lib/instanceKey.js`
- Test: `src/__tests__/lib/instanceKey.test.js`

`materialKey` hashes everything that makes two Materials interchangeable for pooling — texture, UV transform, blend/alpha/fullbright, lit flag, PBR flag — but **NOT color** (color rides `InstancedMesh.instanceColor`, so tinted copies share a pool).

- [ ] **Step 1: Write the failing test**

```js
// src/__tests__/lib/instanceKey.test.js
import { describe, it, expect } from 'vitest'
import { materialKey, uvKey } from '@/lib/instanceKey.js'

describe('materialKey', () => {
	it('is deterministic for equal descriptors', () => {
		const a = { texId: 'abc', uvKey: '', blend: false, alpha: false, fullbright: true, lit: false, pbr: false }
		const b = { ...a }
		expect(materialKey(a)).toBe(materialKey(b))
	})

	it('ignores color (same key regardless of tint)', () => {
		const base = { texId: 'abc', uvKey: '' }
		expect(materialKey({ ...base, color: '#fff' })).toBe(materialKey({ ...base, color: '#f00' }))
	})

	it('differs when a material-determining field differs', () => {
		const base = { texId: 'abc', uvKey: '' }
		expect(materialKey({ ...base, fullbright: true })).not.toBe(materialKey({ ...base, fullbright: false }))
		expect(materialKey({ ...base, texId: 'xyz' })).not.toBe(materialKey(base))
	})
})

describe('uvKey', () => {
	it('returns empty string for identity transform', () => {
		expect(uvKey(null)).toBe('')
	})
	it('encodes repeat/offset/rotation', () => {
		expect(uvKey({ rep: [2, 2], ofs: [0, 0], rot: 0 })).toBe('2,2,0,0,0')
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/lib/instanceKey.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// src/lib/instanceKey.js
// Stable pooling key for a Material. Two objects with the same geometry part AND the
// same materialKey can share one InstancedMesh. Color is DELIBERATELY excluded — it
// rides InstancedMesh.instanceColor so tinted copies still pool together.
// See spec draw-call-instancing.
export function materialKey(p) {
	return [
		p.texId || 'none',
		p.uvKey || '',
		p.blend ? 'B' : '',
		p.alpha ? 'A' : '',
		p.fullbright ? 'F' : '',
		p.lit ? 'L' : '',
		p.pbr ? 'P' : '',
	].join('|')
}

// Encode a TE UV transform into a key fragment (identity → '').
export function uvKey(xform) {
	if (!xform) return ''
	const r = xform.rep || [1, 1], o = xform.ofs || [0, 0], rot = xform.rot || 0
	return `${r[0]},${r[1]},${o[0]},${o[1]},${rot}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/lib/instanceKey.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/instanceKey.js src/__tests__/lib/instanceKey.test.js
git commit -m "feat(instancing): material pooling key"
```

---

### Task 3: `instancePool.js` — the InstancedMesh manager

**Files:**
- Create: `src/lib/instancePool.js`
- Test: `src/__tests__/lib/instancePool.test.js`

Owns all pool `InstancedMesh` objects. Knows nothing about textures — the caller passes a `factory()` that returns `{ geometry, material }`, invoked once when a pool is first created. One *object* may join several pools (one per face-part); `remove(localId)` cleans up all of them. Swap-remove for O(1) eviction; grow-and-copy on overflow; geometry counted once in `bytes()`.

- [ ] **Step 1: Write the failing test**

```js
// src/__tests__/lib/instancePool.test.js
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { createInstancePool } from '@/lib/instancePool.js'

const m4 = (x) => new THREE.Matrix4().setPosition(x, 0, 0)
const factory = () => ({ geometry: new THREE.BoxGeometry(1, 1, 1), material: new THREE.MeshBasicMaterial() })

describe('instancePool', () => {
	it('adds instances and exposes one InstancedMesh per pool key', () => {
		const scene = new THREE.Scene()
		const pool = createInstancePool(scene)
		pool.add('K', factory, m4(0), null, 100)
		pool.add('K', factory, m4(1), null, 101)
		expect(pool.meshes()).toHaveLength(1)
		expect(pool.meshes()[0].count).toBe(2)
		expect(scene.children).toContain(pool.meshes()[0])
	})

	it('pick maps (mesh, instanceId) back to localId', () => {
		const scene = new THREE.Scene()
		const pool = createInstancePool(scene)
		pool.add('K', factory, m4(0), null, 100)
		pool.add('K', factory, m4(1), null, 101)
		const im = pool.meshes()[0]
		expect(pool.pick(im, 0)).toBe(100)
		expect(pool.pick(im, 1)).toBe(101)
	})

	it('swap-remove keeps remaining instances pickable', () => {
		const scene = new THREE.Scene()
		const pool = createInstancePool(scene)
		pool.add('K', factory, m4(0), null, 100)
		pool.add('K', factory, m4(1), null, 101)
		pool.add('K', factory, m4(2), null, 102)
		pool.remove(101)                       // middle
		const im = pool.meshes()[0]
		expect(im.count).toBe(2)
		expect(pool.has(101)).toBe(false)
		expect(pool.has(100)).toBe(true)
		expect(pool.has(102)).toBe(true)
		// 102 swapped into slot 1
		expect(pool.pick(im, 1)).toBe(102)
	})

	it('grows past initial capacity', () => {
		const scene = new THREE.Scene()
		const pool = createInstancePool(scene, { initialCap: 2 })
		for (let i = 0; i < 5; i++) pool.add('K', factory, m4(i), null, 200 + i)
		const im = pool.meshes()[0]
		expect(im.count).toBe(5)
		for (let i = 0; i < 5; i++) expect(pool.pick(im, i)).toBe(200 + i)
	})

	it('disposes a pool when its last instance leaves', () => {
		const scene = new THREE.Scene()
		const pool = createInstancePool(scene)
		pool.add('K', factory, m4(0), null, 100)
		pool.remove(100)
		expect(pool.meshes()).toHaveLength(0)
		expect(scene.children).toHaveLength(0)
	})

	it('one object across multiple pools is fully removed', () => {
		const scene = new THREE.Scene()
		const pool = createInstancePool(scene)
		pool.add('A', factory, m4(0), null, 100)
		pool.add('B', factory, m4(0), null, 100)   // same object, face 2
		expect(pool.meshes()).toHaveLength(2)
		pool.remove(100)
		expect(pool.meshes()).toHaveLength(0)
		expect(pool.has(100)).toBe(false)
	})

	it('bytes counts geometry once per pool', () => {
		const scene = new THREE.Scene()
		const pool = createInstancePool(scene)
		pool.add('K', factory, m4(0), null, 100)
		pool.add('K', factory, m4(1), null, 101)
		expect(pool.bytes()).toBeGreaterThan(0)
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/lib/instancePool.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// src/lib/instancePool.js
import * as THREE from 'three'

// Manages the set of InstancedMesh objects that render pooled (repeated) geometry.
// poolKey = `${geomKey}::${materialIndex}::${materialKey}`. The caller supplies a
// factory() → {geometry, material} used ONCE when a pool is first created (so this
// module stays ignorant of textures/caches). One object may join several pools (one
// per face-part); remove(localId) cleans up every pool it joined.
// See spec draw-call-instancing.
const INITIAL_CAP = 16

export function createInstancePool(scene, opts = {}) {
	const initialCap = opts.initialCap ?? INITIAL_CAP
	const pools = new Map()          // poolKey → { im, cap, count, idAt:[], slotOf:Map }
	const objPools = new Map()       // localId → poolKey[]
	const _m = new THREE.Matrix4()
	const _c = new THREE.Color()

	function createPool(poolKey, factory) {
		const { geometry, material } = factory()
		const im = new THREE.InstancedMesh(geometry, material, initialCap)
		im.count = 0
		im.frustumCulled = false       // pools group by key, not location; instanced submit is cheap
		const pool = { im, cap: initialCap, count: 0, idAt: [], slotOf: new Map() }
		im.userData.qsPool = pool
		im.userData.qsInstanced = true
		pools.set(poolKey, pool)
		scene.add(im)
		return pool
	}

	function grow(pool) {
		const newCap = pool.cap * 2
		const old = pool.im
		const im = new THREE.InstancedMesh(old.geometry, old.material, newCap)
		im.count = pool.count
		im.frustumCulled = false
		im.userData.qsPool = pool
		im.userData.qsInstanced = true
		for (let i = 0; i < pool.count; i++) {
			old.getMatrixAt(i, _m); im.setMatrixAt(i, _m)
			if (old.instanceColor) { old.getColorAt(i, _c); im.setColorAt(i, _c) }
		}
		im.instanceMatrix.needsUpdate = true
		if (im.instanceColor) im.instanceColor.needsUpdate = true
		scene.remove(old)
		// do NOT dispose geometry/material — reused by the new InstancedMesh
		old.dispose()
		scene.add(im)
		pool.im = im
		pool.cap = newCap
	}

	function add(poolKey, factory, matrix, color, localId) {
		let pool = pools.get(poolKey)
		if (!pool) pool = createPool(poolKey, factory)
		if (pool.count >= pool.cap) grow(pool)
		const slot = pool.count++
		pool.im.setMatrixAt(slot, matrix)
		pool.im.instanceMatrix.needsUpdate = true
		if (color) {
			pool.im.setColorAt(slot, color)
			pool.im.instanceColor.needsUpdate = true
		}
		pool.im.count = pool.count
		pool.idAt[slot] = localId
		pool.slotOf.set(localId, slot)
		let keys = objPools.get(localId)
		if (!keys) { keys = []; objPools.set(localId, keys) }
		keys.push(poolKey)
	}

	function removeFromPool(poolKey, localId) {
		const pool = pools.get(poolKey)
		if (!pool) return
		const slot = pool.slotOf.get(localId)
		if (slot === undefined) return
		const last = pool.count - 1
		if (slot !== last) {
			pool.im.getMatrixAt(last, _m); pool.im.setMatrixAt(slot, _m)
			if (pool.im.instanceColor) { pool.im.getColorAt(last, _c); pool.im.setColorAt(slot, _c) }
			const movedId = pool.idAt[last]
			pool.idAt[slot] = movedId
			pool.slotOf.set(movedId, slot)
		}
		pool.count--
		pool.im.count = pool.count
		pool.im.instanceMatrix.needsUpdate = true
		if (pool.im.instanceColor) pool.im.instanceColor.needsUpdate = true
		pool.idAt.length = pool.count
		pool.slotOf.delete(localId)
		if (pool.count === 0) {
			scene.remove(pool.im)
			pool.im.geometry.dispose()
			const mat = pool.im.material
			if (Array.isArray(mat)) mat.forEach(m => m.dispose?.()); else mat.dispose?.()
			pool.im.dispose()
			pools.delete(poolKey)
		}
	}

	function remove(localId) {
		const keys = objPools.get(localId)
		if (!keys) return
		for (const k of keys) removeFromPool(k, localId)
		objPools.delete(localId)
	}

	function pick(instancedMesh, instanceId) {
		const pool = instancedMesh?.userData?.qsPool
		return pool ? (pool.idAt[instanceId] ?? null) : null
	}

	function has(localId) { return objPools.has(localId) }
	function meshes() { return [...pools.values()].map(p => p.im) }

	function bytes() {
		let b = 0
		for (const p of pools.values()) {
			const g = p.im.geometry
			for (const a of Object.values(g.attributes || {})) b += a.array?.byteLength || 0
			b += g.index?.array?.byteLength || 0
			b += p.im.instanceMatrix?.array?.byteLength || 0
			b += p.im.instanceColor?.array?.byteLength || 0
		}
		return b
	}

	function dispose() {
		for (const p of pools.values()) {
			scene.remove(p.im)
			p.im.geometry.dispose()
			const mat = p.im.material
			if (Array.isArray(mat)) mat.forEach(m => m.dispose?.()); else mat.dispose?.()
			p.im.dispose()
		}
		pools.clear()
		objPools.clear()
	}

	return { add, remove, pick, has, meshes, bytes, dispose }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/lib/instancePool.test.js`
Expected: PASS (7 tests). If `getColorAt` throws on a pool that never set a color, it is guarded by the `instanceColor` null-check — confirm no failures.

- [ ] **Step 5: Commit**

```bash
git add src/lib/instancePool.js src/__tests__/lib/instancePool.test.js
git commit -m "feat(instancing): InstancedMesh pool manager"
```

---

## Phase 2 — Flag

### Task 4: Add the `instancing` Prefs flag (default OFF)

**Files:**
- Modify: `src/stores/uiStore.js`
- Modify: `src/components/PreferencesFloater.vue` (Graphics section)

- [ ] **Step 1: Find the existing persisted-boolean pattern**

Run: `grep -n "litShading\|drawDistance\|geomCacheRamMb" src/stores/uiStore.js`
Expected: shows how a persisted setting is declared + included in the persistence payload.

- [ ] **Step 2: Add the flag**

In `src/stores/uiStore.js`, mirror the `litShading` declaration exactly (state ref + inclusion in whatever load/persist list `litShading` uses). Add:

```js
const instancing = ref(false)   // FEATURE-GAPS #6 draw-call instancing — default OFF until live-verified
```

Add `instancing` to the same persisted-keys list and the returned object that `litShading` appears in (match the file's existing structure — do not invent a new persistence mechanism).

- [ ] **Step 3: Add the Prefs toggle**

Run: `grep -n "litShading" src/components/PreferencesFloater.vue`
Then add a checkbox row immediately after the lit-shading row, copying its markup/binding and changing the label to `Draw-call instancing (experimental)` bound to `uiStore.instancing`.

- [ ] **Step 4: Verify build**

Run: `npm run build:staging`
Expected: `✓ built`.

- [ ] **Step 5: Commit**

```bash
git add src/stores/uiStore.js src/components/PreferencesFloater.vue
git commit -m "feat(instancing): add Prefs flag (default off)"
```

---

## Phase 3 — Integration in `useWorldEngine.js`

> These tasks touch a 4,145-line file with live Three.js state, so unit-testing in isolation is limited; correctness is proven by the build + the live-verify gate (Task 11), consistent with the project's "done = usable experience" rule. Each task is still small and independently committable. All new code is gated on `uiStore.instancing` so an OFF flag is a guaranteed no-op (zero regression).

### Task 5: Settle/dynamic tracking

**Files:**
- Modify: `src/composables/useWorldEngine.js` (near the `meshMap` declaration ~line 268; the position-update path)

Track the last time each object moved, so the migrate pass can tell "settled" from "in motion". Avatars are always dynamic.

- [ ] **Step 1: Add the move-time map + pool handle**

After the `meshMap` declaration (~line 268), add:

```js
// FEATURE-GAPS #6 instancing: per-object last-move time (perf.now) for settle detection,
// and the instance pool (created lazily on first use so an OFF flag costs nothing).
const _lastMoveAt = new Map()   // localId → performance.now() of last position/rot change
let _instancePool = null        // createInstancePool(scene) — see ensureInstancePool()
const SETTLE_MS = 3000          // no-move dwell before an object may be instanced (tunable)
const MOVE_EPS = 0.01           // metres/quaternion delta that counts as "moved"
```

- [ ] **Step 2: Add the lazy pool accessor**

Add near the other small helpers (e.g. just below the block above):

```js
import { createInstancePool } from '@/lib/instancePool.js'   // add to the import block at top
import { splitParts } from '@/lib/geomParts.js'
import { materialKey, uvKey } from '@/lib/instanceKey.js'

function ensureInstancePool() {
	if (!_instancePool) _instancePool = createInstancePool(scene)
	return _instancePool
}
```

(Place the three `import` lines with the other `@/lib/...` imports at the top of the file, not inside the function.)

- [ ] **Step 3: Stamp move-time on position updates**

Find the function that applies inbound position/rotation (search `grep -n "function updateObjectPos\|matrixWorldNeedsUpdate\|gsap.to" src/composables/useWorldEngine.js` and the TerseUpdate apply site). Where an object's mesh position/quaternion is set from an inbound update, add:

```js
_lastMoveAt.set(localId, performance.now())
// if this object is currently instanced, it just became dynamic → promote it out
if (_instancePool && _instancePool.has(localId)) promoteOut(localId)
```

`promoteOut` is defined in Task 7; this references it forward (same file).

- [ ] **Step 4: Verify build**

Run: `npm run build:staging`
Expected: `✓ built` (a forward reference to `promoteOut` is fine — function declarations hoist).

- [ ] **Step 5: Commit**

```bash
git add src/composables/useWorldEngine.js
git commit -m "feat(instancing): settle/move tracking"
```

---

### Task 6: Migrate-in pass

**Files:**
- Modify: `src/composables/useWorldEngine.js`

Fold settled individual meshes into the pool. An object is eligible when: flag ON, it has a `meshMap` entry, it is not an avatar, its geometry is baked (not the placeholder box — guard on the same `_placeholder` flag the file uses), it has a resolved material, and `now - lastMove ≥ SETTLE_MS`.

- [ ] **Step 1: Add the migrate helpers**

Add these functions in the file (near `cullTick`, ~line 3149). They reuse existing helpers: `geomKey` derivation (lines 1853-1856), `pickPrimTexture`, `isRealTex`, `hasMultiFaceMesh`, `hasMultiFacePrim`, and `getTexture`.

```js
// Build the pool factory + per-part descriptors for an object's live mesh. Returns
// null if the object is not yet instanceable (geometry/material not ready).
function describeForPool(localId, mesh, obj) {
	const geom = mesh.geometry
	if (!geom || geom.userData?._placeholder || mesh.userData?._placeholder) return null
	const parts = splitParts(geom)
	const lit = uiStore.litShading && !obj.defaultFullbright
	const out = []
	for (const part of parts) {
		const faceTex = (obj.faceTextures && obj.faceTextures[part.materialIndex]) || obj.defaultTexture
		const texId = isRealTex(faceTex) ? faceTex : (isRealTex(obj.defaultTexture) ? obj.defaultTexture : null)
		const matKey = materialKey({
			texId, uvKey: '', fullbright: !!obj.defaultFullbright, lit,
			alpha: !!(obj.defaultColor && obj.defaultColor[3] < 0.99),
		})
		const poolKey = `${geomKeyFor(obj)}::${part.materialIndex}::${matKey}`
		out.push({ poolKey, part, texId, lit })
	}
	return out
}

// Re-derive the geomKey the same way upsertMesh does (lines 1853-1856).
function geomKeyFor(obj) {
	const bakeScale = (obj.meshId || obj.sculptId) ? [1, 1, 1] : (obj.scale || [1, 1, 1])
	return obj.meshId ? meshGeomKey(obj.meshId)
		: obj.sculptId ? sculptGeomKey(obj.sculptId, obj.sculptType ?? 1)
		: primGeomKey(obj.shape, bakeScale)
}

function migrateIn(localId, mesh, obj) {
	const desc = describeForPool(localId, mesh, obj)
	if (!desc) return false
	mesh.updateWorldMatrix(true, false)
	const matrix = mesh.matrixWorld.clone()
	const color = new THREE.Color(obj.defaultColor ? obj.defaultColor[0] : 1,
		obj.defaultColor ? obj.defaultColor[1] : 1, obj.defaultColor ? obj.defaultColor[2] : 1)
	const pool = ensureInstancePool()
	for (const d of desc) {
		const factory = () => {
			const mat = new THREE.MeshBasicMaterial({ color: 0xffffff })
			if (d.texId) { const t = getTexture(d.texId); if (t) mat.map = t }
			mat.needsUpdate = true
			return { geometry: d.part.geometry, material: mat }
		}
		pool.add(d.poolKey, factory, matrix, color, localId)
	}
	removeMesh(localId)   // drop the individual mesh now that the instance carries it
	return true
}
```

> NOTE for the implementer: `MeshBasicMaterial` is the v1 pool material to keep scope tight (matches the dominant non-lit prim path). Lit/PBR pooled materials are a follow-up; objects on the lit path still instance but render unlit while the flag is experimental — acceptable for the default-OFF A/B. If a quick win is wanted, branch the factory on `d.lit` to `MeshLambertMaterial`.

- [ ] **Step 2: Drive the pass from `cullTick`**

Inside `cullTick` (line 3149), after the existing stream-out loop, add a guarded migration sweep:

```js
if (uiStore.instancing) {
	const now = performance.now()
	let budget = 256   // cap migrations per tick to avoid a hitch
	for (const [id, mesh] of meshMap) {
		if (budget <= 0) break
		const obj = worldStore.objects.get(id)
		if (!obj || obj.pcode === PCODE_AVATAR) continue
		const lastMove = _lastMoveAt.get(id) ?? 0
		if (now - lastMove < SETTLE_MS) continue
		if (migrateIn(id, mesh, obj)) budget--
	}
}
```

> `worldStore.objects.get(id)` — if `objects` is not a Map in this store, use the same access pattern the rest of `cullTick` already uses to read an object by id.

- [ ] **Step 3: Verify build + existing tests**

Run: `npm run build:staging && npx vitest run`
Expected: build `✓`, all existing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add src/composables/useWorldEngine.js
git commit -m "feat(instancing): migrate-in pass"
```

---

### Task 7: Promote-out pass

**Files:**
- Modify: `src/composables/useWorldEngine.js`

Pull an instanced object back to an individual mesh when it goes dynamic (already wired in Task 5 Step 3) or is selected for edit. Rebuild via the existing upsert path.

- [ ] **Step 1: Add `promoteOut`**

Add near `migrateIn`:

```js
// Pull an object out of the instance pool back to an individual mesh (it went dynamic
// or was edit-selected). Rebuilds through the normal upsert path so it behaves exactly
// like a never-instanced object until it re-settles and migrateIn re-pools it.
function promoteOut(localId) {
	if (!_instancePool || !_instancePool.has(localId)) return
	_instancePool.remove(localId)
	const obj = worldStore.objects.get(localId)
	if (obj) upsertMesh(obj)   // recreates the individual THREE.Mesh
}
```

- [ ] **Step 2: Promote on edit-select**

Find where the gizmo attaches to a selected object (`grep -n "gizmo\|attach\|TransformControls\|selectedLocalId" src/composables/useWorldEngine.js`). At the point an object becomes the edit target, add (before attaching the gizmo to its mesh):

```js
promoteOut(selectedId)   // ensure an individual mesh exists for the gizmo to grab
```

(Use whatever variable holds the selected localId at that site.)

- [ ] **Step 3: Verify build**

Run: `npm run build:staging`
Expected: `✓ built`.

- [ ] **Step 4: Commit**

```bash
git add src/composables/useWorldEngine.js
git commit -m "feat(instancing): promote-out on dynamic/edit"
```

---

### Task 8: Cull integration (evict/reload instanced objects)

**Files:**
- Modify: `src/composables/useWorldEngine.js` (`cullTick` ~3149, `removeMesh` ~2264)

The eviction candidate loop currently iterates `meshMap` only. Instanced objects aren't in `meshMap`, so they must also be evictable by distance, and `removeMesh` must tolerate being called for an id that lives in a pool.

- [ ] **Step 1: Make `removeMesh` pool-aware**

In `removeMesh` (line 2264), at the top add:

```js
if (_instancePool && _instancePool.has(localId)) { _instancePool.remove(localId); return }
```

So a cull/eviction of an instanced object removes its instance rather than no-oping on the absent `meshMap` entry.

- [ ] **Step 2: Include instanced objects in eviction candidates**

In `cullTick`'s stream-out candidate build (the `for (const [id] of meshMap)` loop ~line 3213), after it, add instanced ids as candidates (guarded):

```js
if (uiStore.instancing && _instancePool) {
	for (const [id] of _lastMoveAt) {              // ids that have been seen; cheap superset
		if (!_instancePool.has(id)) continue
		const obj = worldStore.objects.get(id)
		if (!obj) continue
		const d = /* distance from camera to obj, same calc the loop above uses */ 0
		candidates.push({ id, dist: d })           // match the candidate shape used by selectEvictions
	}
}
```

> The implementer must compute `d` with the SAME distance function the existing candidate loop uses (copy that one line), and push the SAME object shape `selectEvictions` expects. When an instanced id is selected for eviction, the existing eviction call path runs `removeMesh(id)`, which Step 1 routed to `_instancePool.remove`. Reload (`selectReloads`) already re-queues ids into `pendingMeshIds`; the rebuilt individual mesh will re-settle and re-migrate naturally.

- [ ] **Step 3: Verify build + tests**

Run: `npm run build:staging && npx vitest run`
Expected: build `✓`, tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/composables/useWorldEngine.js
git commit -m "feat(instancing): cull evict/reload pooled objs"
```

---

### Task 9: Raycast picking for instanced meshes

**Files:**
- Modify: `src/composables/useWorldEngine.js` (the three `primTargets`/raycast sites: ~955-965, ~2943-2950, ~3013-3019)

Add pool meshes to the raycast target lists and map an instanced hit back to `localId`.

- [ ] **Step 1: Add pool meshes to each target list**

At each site that builds `primTargets` (or `targets`) by iterating `meshMap`, after the loop add:

```js
if (_instancePool) for (const im of _instancePool.meshes()) primTargets.push(im)
```

(Use the local variable name at each site — `primTargets` or `targets`.)

- [ ] **Step 2: Resolve an instanced hit to localId**

At each site that reads the hit and walks `m.parent` to find `userData.localId`, handle the instanced case first:

```js
const hit = hits[0]
let pickedId = null
if (hit?.object?.userData?.qsInstanced) {
	pickedId = _instancePool.pick(hit.object, hit.instanceId)
} else {
	// existing logic: walk hit.object.parent up to find userData.localId
}
```

Then use `pickedId` where the existing code used the resolved localId.

- [ ] **Step 3: Verify build**

Run: `npm run build:staging`
Expected: `✓ built`.

- [ ] **Step 4: Commit**

```bash
git add src/composables/useWorldEngine.js
git commit -m "feat(instancing): instanced raycast picking"
```

---

### Task 10: Memory stats — count pool geometry once

**Files:**
- Modify: `src/composables/useWorldEngine.js` (the 3s stats scan, `geomB` loop ~3981-3991 / `_lastGeomB` ~4049)

The governor reads `setAppBytes`. Pool geometry must be counted once (via `pool.bytes()`), and the `objs=` telemetry should reflect instanced objects so the `[Mem]` line stays meaningful.

- [ ] **Step 1: Add pool bytes to the scan**

In the `geomB` accumulation (after the `for (const mm of meshMap.values())` loop ~line 3987), add:

```js
if (_instancePool) geomB += _instancePool.bytes()
```

`_lastGeomB = geomB` (already there) then feeds `setAppBytes(texB + meshB + geomB)`.

- [ ] **Step 2: Reflect instanced objects in the `objs=` count**

In the `[Mem]` log line (~line 4049), change `objs=${meshMap.size}` to include pooled objects:

```js
const instObjs = _instancePool ? _instancePool /* expose a count */ : 0
```

Add a `count()` accessor to `instancePool.js` returning `objPools.size`, export it in the returned object, then use `objs=${meshMap.size + (_instancePool?.count() ?? 0)}` and add ` inst=${_instancePool?.count() ?? 0}` to the line for visibility.

- [ ] **Step 3: Add `count()` to instancePool + test**

In `src/lib/instancePool.js` add `function count() { return objPools.size }` and include `count` in the returned object. In `src/__tests__/lib/instancePool.test.js` add:

```js
it('count reflects distinct objects', () => {
	const scene = new THREE.Scene()
	const pool = createInstancePool(scene)
	pool.add('A', factory, m4(0), null, 100)
	pool.add('B', factory, m4(0), null, 100)   // same object
	pool.add('A', factory, m4(1), null, 101)
	expect(pool.count()).toBe(2)
})
```

- [ ] **Step 4: Verify build + tests**

Run: `npx vitest run src/__tests__/lib/instancePool.test.js && npm run build:staging`
Expected: PASS + `✓ built`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/instancePool.js src/__tests__/lib/instancePool.test.js src/composables/useWorldEngine.js
git commit -m "feat(instancing): pool-aware memory stats"
```

---

### Task 11: Relight rebuild + live-verify gate

**Files:**
- Modify: `src/composables/useWorldEngine.js` (`relightScene` ~3543)

- [ ] **Step 1: Drop pools on relight**

In `relightScene(on)` (line 3543), since pooled materials bake the lit flag at creation, the simplest correct response to a global relight is to dissolve the pool so objects re-migrate under the new lighting. Add at the top of `relightScene`:

```js
if (_instancePool) { _instancePool.dispose(); _instancePool = null; _lastMoveAt.clear() }
```

The relit individual meshes will re-settle and re-migrate. (Relight is a rare, user-initiated toggle — full rebuild is acceptable.)

- [ ] **Step 2: Verify build + full test suite**

Run: `npm run build:staging && npx vitest run`
Expected: build `✓`; all tests pass.

- [ ] **Step 3: Live-verify on a heavy region (manual gate — definition of done)**

With `npm run dev` running, hard-reload into a heavy region, let it settle, then:

1. **Baseline (flag OFF):** run `qsCensus()` — record `DRAW CALLS` and `effNear`.
2. **Flag ON:** enable Prefs▸Graphics ▸ "Draw-call instancing", wait ~5s for the migrate pass, run `qsCensus()` again. Watch the `[Mem]` line for `inst=` climbing and `geomMB` dropping.
3. Confirm:
   - [ ] Draw calls drop from ~17k toward the low thousands (renderer.info.render.calls if exposed, or the census proxy).
   - [ ] `effNear` recovers above 32m (or `[Mem]` app% drops materially).
   - [ ] Scene looks correct: instanced objects have right transform/texture/tint; multi-face meshes still show per-face textures.
   - [ ] Right-click / edit-select an instanced object → it promotes out and the gizmo grabs it; dragging works.
   - [ ] Walk a scripted/moving prim into view → renders smoothly (promoted out, not stuck).
   - [ ] Fly away and back → pools shrink/grow with no leak (`inst=` and `geomMB` track; no monotonic climb).
4. Report findings to Gene. Do NOT flip the default to ON — that is Gene's call after he reviews the A/B.

- [ ] **Step 4: Commit**

```bash
git add src/composables/useWorldEngine.js
git commit -m "feat(instancing): relight pool rebuild"
```

---

## Cleanup (after Gene signs off on live-verify)

- [ ] Remove the `qsCensus()` DEV block from `useWorldEngine.js` (added during brainstorming, ~after `_cullTimer`).
- [ ] Update `docs/FEATURE-GAPS.md` item #6 status with the measured before/after draw calls and effNear.
- [ ] Add a memory note (`memory/`) once verified, linking `[[render-cache-backlog]]`.

---

## Self-Review

**Spec coverage:**
- Migration-layer architecture → Tasks 5–7. ✅
- Pool key `geomKey∷partIndex∷materialKey` → `describeForPool` (Task 6) + `materialKey` (Task 2). ✅
- Per-face decomposition → `splitParts` (Task 1) + per-part loop (Task 6). ✅
- Per-instance color via `instanceColor`, color excluded from key → Task 2 + `add` color arg (Task 3). ✅
- World matrices from live mesh `matrixWorld` → `migrateIn` (Task 6). ✅
- Settle rule (3s + baked + textured) → Task 5 (`SETTLE_MS`) + Task 6 guards. ✅
- Promote-out triggers (move / edit / script) → Task 5 Step 3 + Task 7. ✅
- Cull evict/reload, geometry resident until last instance → Task 8 + `instancePool` dispose-on-empty (Task 3). ✅
- Picking instanceId→localId → Task 9 + `pick` (Task 3). ✅
- Memory counts geometry once → Task 10 + `bytes()` (Task 3). ✅
- Relight rebuild → Task 11. ✅
- Flag default OFF → Task 4; every integration site guarded on `uiStore.instancing`. ✅
- Out-of-scope (scale-decouple, singleton merge, spatial pools) → not implemented, correct. ✅

**Placeholder scan:** No TBD/TODO-without-code. Integration tasks that depend on exact in-file variable names (distance calc in Task 8, selected-id var in Task 7, position-apply site in Task 5) give the `grep` to find the site and the exact code to insert — flagged as implementer-adapts, not vague.

**Type consistency:** `createInstancePool(scene, opts)` returns `{ add, remove, pick, has, meshes, bytes, dispose, count }` — `count` added in Task 10 Step 3. `add(poolKey, factory, matrix, color, localId)` signature consistent across Tasks 3/6. `splitParts(geometry) → [{materialIndex, geometry}]` consistent (Tasks 1/6). `materialKey(descriptor)` / `uvKey(xform)` consistent (Tasks 2/6). `qsInstanced`/`qsPool` userData flags consistent (Tasks 3/9).
