# Draw-Call Instancing (FEATURE-GAPS #6) — Design

**Date:** 2026-06-13
**Status:** Design approved, pre-implementation
**Item:** FEATURE-GAPS #6 — draw-call instancing / merging
**Branch target:** `ai/draw-call-instancing` off `phase3`

---

## Problem

`WebGLRenderer.render` self-time is the dominant frame cost on heavy regions
(profiled ~1540–3462ms, 12–22%, uncontested at the top of Bottom-Up after the
avatars O(n²) fix). The cause is one `THREE.Mesh` per object plus per-face
material arrays.

### Census evidence (live, heavy region, 2026-06-13 — `qsCensus()`)

```
objects(worldStore): 15380   rendered(meshMap): 9083   effNear: 32m   ← at the cull floor
DRAW CALLS (incl per-face arrays): 17373   multi-material meshes: 2356
rendered type split: prim=1696  mesh=6869  sculpt=518
per-face blockers (material array): 2366

INSTANCING — shape+scale (current keying):
  distinct keys: 2333   ≥2: 1247 keys / 7997 objs   ≥4: 363 keys / 5940 objs
INSTANCING — shape only (scale→matrix):
  distinct keys: 1974   ≥2: 1111 keys / 8220 objs   ≥4: 319 keys / 6367 objs
MERGE-BY-TEXTURE:
  distinct textures: 917   ≥2: 537 textures / 8703 objs
LINKSETS:
  roots: 2072   ≥2 prims: 946 linksets / 7957 objs   largest: 285,285,285,209,…
```

**Reading of the data:**

- **17,373 draw calls**, of which **~8,290 (48%)** come from just **2,356 per-face
  material-array meshes**. Per-face is half the cost.
- Scene is **mesh-asset dominated** (mesh=6869 / 76%), not prims.
- **Instancing coverage with the *existing* `geomKey` is already huge**: 88% of
  rendered objects (7,997 / 9,083) are in identical groups of ≥2; 65% in groups
  of ≥4. 9,083 objects collapse to **2,333 distinct geometries**.
- `effNear` is pinned at the **32m floor** — the census was taken under the #13
  cull-spiral. Instancing shares one GPU geometry per key, so it cuts VRAM and
  should let the governor release the floor.

### Why not merge-by-texture

Texture sharing is also high, but static geometry merging is the wrong tool for
this scene: it must re-merge giant static buffers every `cullTick` (1s) as
objects stream in/out, **duplicates** vertices (more VRAM, not less), needs
per-triangle→localId picking, and fights incremental object arrival.
Instancing fits the dynamic/streaming/repetitive reality. Deferred as approach C
(singleton tail) — not v1.

---

## Goal

Render repeated geometry through `InstancedMesh` instead of one `THREE.Mesh` per
object. Target: **17,373 → ~2,500–3,500 draw calls** (≈5–7×), fewer scene-graph
nodes to traverse (the actual `render` self-time driver), and a large VRAM drop
from shared geometry that feeds the #13 governor.

**No GEOM_VERSION bump, no cache wipe.** v1 uses the current `geomKey`.

---

## Architecture — instancing as a post-settle migration layer

`upsertMesh` is **not** rewritten. The arrival path is untouched
(placeholder box → async bake → texture → individual `THREE.Mesh`). Instancing is
a layer on top, driven by two passes:

- **Migrate-in pass:** scans *settled* individual meshes and folds them into
  instance pools, then removes the individual mesh.
- **Promote-out pass:** pulls an instance back to an individual mesh the instant
  it goes dynamic (moves, edit-selected, or scripted).

Rationale: the cold-load experience (the hard-won stable part) is unchanged; the
win accrues in steady state (flying around) where render cost dominates; every
object is fully reversible between representations.

### New modules (isolated, unit-testable without a GL context)

| Module | Responsibility | API (sketch) |
|--------|----------------|--------------|
| `src/lib/instancePool.js` | Owns the `InstancedMesh` objects for a set of pool keys. Swap-remove for O(1) eviction; grow-and-copy on capacity overflow. | `add(poolKey, parts, matrix, color, localId)`, `remove(localId)`, `pick(instancedMesh, instanceId) → localId`, `meshes()`, `bytes()`, `dispose()` |
| `src/lib/instanceKey.js` | Derives `materialKey` from an object/material. | `materialKey(matParams) → string` |
| `src/lib/geomParts.js` | Slices cached geometry `groups` into one sub-`BufferGeometry` per `materialIndex`; cached per `geomKey`. | `splitParts(cachedArrays) → [{ geometry, materialIndex }]` |

`InstancedMesh` construction, `setMatrixAt`, `setColorAt` are all CPU-side — no
WebGL context required, so these modules are testable under jsdom with real THREE
objects.

The `useWorldEngine.js` changes are orchestration only: the two passes, `cullTick`
eviction/reload, raycast picking, and the memory stats scan.

---

## Pool keying & per-face decomposition

- **Pool key = `geomKey ∷ partIndex ∷ materialKey`.**
  - Single-material object → one part (full geometry).
  - Multi-material mesh → N parts, one per face-group; each part is an
    `InstancedMesh` over that group's sub-geometry + that group's material.
    A 199× four-face mesh → ~4 draw calls instead of 796.
- **`materialKey`** hashes everything that determines the Material *except color*:
  texture id, `uvXform` (TE repeat/offset/rotation), blend/alpha mode, fullbright,
  and the lit-shading flag.
- **Per-instance color via `InstancedMesh.instanceColor`** — deliberately *out*
  of `materialKey` so same-geometry/same-texture prims with different tints still
  share one pool. Pool material base color = white; `instanceColor` multiplies.
- **World matrices, not parented.** Instances live flat under the scene, not in
  the linkset hierarchy. Migration snapshots the live individual mesh's
  already-correct `matrixWorld` (`updateWorldMatrix(true,false)`), so linkset
  children Just Work with no new transform math.

---

## Object lifecycle

**Settle rule (approved):** an object is eligible to migrate-in once it is
**baked** (real geometry, not the placeholder box), has a **real texture applied**,
and has had **no position/rotation update for ~3s** (`SETTLE_MS`, tunable).

- **Migrate-in:** compute pool key from the mesh's resolved material + cached
  geometry → `pool.add(matrixWorld, color, localId)` → `removeMesh(localId)` of the
  individual. Geometry parts are split once per `geomKey` (cached) on first use.
- **Promote-out triggers:** TerseUpdate position/rotation delta > epsilon, gizmo
  attach (edit-select), or scripted rotation → `pool.remove(localId)` → rebuild the
  individual via the existing upsert path. Re-settles → migrates back.
- **Cull (`cullTick`):** an instanced object is evicted via `pool.remove`
  (swap-remove). Shared geometry stays resident until the *last* instance of that
  key leaves. Reload re-adds the instance. **Avatars never instance.**
- **Texture/TE change on a pooled object:** treated as a change → promote-out, then
  re-migrate into the new pool. Reuses the promotion path.
- **Lit-shading relight:** `materialKey` includes the lit flag; a global relight
  rebuilds affected pools (rare event, acceptable cost).

---

## Picking / raycasting

`primTargets` gains the pool `InstancedMesh` objects. An instanced hit yields an
`instanceId`; `pool.pick(mesh, instanceId)` maps it back to `localId` via the
pool's slot→localId reverse array. Object-level granularity — matches today's
bounding-box-level picking (per-triangle face picking is a separate future item).

---

## Memory / governor coupling (#13)

The stats scan feeding `setAppBytes` must count each **pool geometry once** (not
per instance) plus the small instance matrix/color buffers. This both fixes a
latent over-count and reflects the real VRAM drop. Expected effect: same scene,
far less geometry memory → governor stops throttling → `effNear` steps back up off
the 32m floor. **To be confirmed live, not assumed.**

---

## Out of scope for v1 (YAGNI / cache discipline)

- **Prim scale-decoupling** (shape-only keying; the 844× prim) — changes `geomKey`
  = cache wipe. **Deferred to ride item 8's batched GEOM_VERSION bump.** v1 keeps
  scale baked in; current keying already covers 88%/65%.
- **Singleton merge-by-texture** (approach C) — ~12% tail, deferred.
- **Spatial-partitioned pools** for per-region frustum culling — only if a pool's
  spatial spread proves to hurt; distance-culling already keeps pools local-ish,
  and instanced submission is cheap even unculled (the cost we fight is CPU
  draw-call/traversal, not GPU fill).

---

## Testing & rollout

- **Vitest** (no GL context): `instancePool` (add / remove / swap-remove / grow /
  pick / bytes), `instanceKey`, `geomParts` (group slicing correctness).
- **Rollout: Prefs▸Graphics toggle, default OFF** (`uiStore`), mirroring the
  lit-shading / draw-distance pattern. Flip on a heavy region, compare `qsCensus()`
  draw calls + watch `effNear`/FPS, promote to default-on only after live-verify.
- Keep the `qsCensus()` DEV hook (already in `useWorldEngine.js`, uncommitted) until
  v1 is verified, then remove it.

### Verification (definition of done — "usable experience", not green tests)

1. `qsCensus()` on the same heavy region shows draw calls dropping from ~17k to the
   low thousands with the flag on.
2. `effNear` recovers above the 32m floor (or memory headroom visibly improves on
   the `[Mem]` line).
3. No visual regression: instanced objects render with correct transform, texture,
   per-face materials, and tint; edit/gizmo still selects and drags; moving prims
   render smoothly (promoted out).
4. No new churn/leak on a fly-through (pools grow/shrink cleanly; `bytes()` tracks).

---

## Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Mesh-lifecycle surgery destabilizes the stable cold path | Migration is a *layer*; arrival path untouched; flag-gated default-off |
| Pool capacity thrash on a fly-through | Grow-and-copy with headroom + O(1) swap-remove; measure `bytes()` |
| Per-instance world matrix wrong for linkset children | Snapshot the live mesh `matrixWorld` (already correct) — no recompute |
| Picking breaks on instanced objects | `pool.pick` reverse map; covered by the verification pass |
| Governor accounting double-counts shared geometry | Stats scan counts pool geometry once (explicit design point) |
| Promote-out misses a dynamic trigger → instanced object appears stuck | Triggers: move-delta, gizmo attach, scripted spin; settle is conservative (3s) |
