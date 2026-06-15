# Render / Cache — Unified Model

> Consolidates FEATURE-GAPS **#6, #9, #10, #11, #13, #14** + textures into one mental model, written
> 2026-06-14 after a long live-debug session on a 24k-object region (Aspen Homesites, neverworldgrid).
> Read this BEFORE touching the render/cache path — these issues are not independent; a fix for one
> shifts the bottleneck to another. The matrix at the bottom says which dominates per region type.

---

## Two hard ceilings (why we will never match Firestorm head-on)

1. **One main thread builds the scene.** Even with every byte cached, the client assembles meshes +
   applies textures in **paced per-frame batches** (so the tab doesn't freeze). Firestorm is native and
   multi-threaded; it builds in parallel. A browser's single main thread caps objects-built-per-second
   regardless of cache. **This is the dominant bottleneck (#11).** No cache or budget fixes it — only
   moving work off-thread (OffscreenCanvas/worker) or building *less* (LOD, near-first) does.
2. **Chrome's ~4 GB per-tab heap limit**, independent of system RAM. `performance.memory.jsHeapSizeLimit`
   reads ~4 GB on a 16 GB box and a 128 GB box alike. So we cannot hold a dense region the way FS holds
   it in all of system RAM. This is *why* the heap brake/governor exist and why "great RAM" doesn't
   lift the wall. It also means every budget auto-scales off this number → **defaults adapt for every
   user without detecting system RAM** (the sliders are power-user tuning, not required).

**Consequence:** a *light* region can be near-FS-fast warm; a *dense 24k* region is the worst case and
will stay seconds-vs-minutes behind FS until off-thread building lands. Realistic goal = make **nearby**
feel instant (near-first), not make the whole 24k region instant.

---

## The pipeline + what each layer caches

```
sim → server (decode ObjectUpdate, transcode J2C→WebP) → client (bake geom, build mesh, apply tex) → GPU
```

| Layer | Holds | Persistence | Sized by |
|---|---|---|---|
| **qs-geom** (geomCache) | baked geometry arrays | IDB, cross-session | 0.3 × quota, ≤4 GB |
| **geom mem tier** (byteLRU) | hand-out copies of baked geom | RAM only | own CPU-RAM budget ≈ 0.30 × heap-headroom, clamp 128–1024 MB (~768 on a 4 GB heap), +slider |
| **geom write buffer** | baked arrays awaiting IDB flush | RAM, transient | hard-capped 256 MB |
| **qs-tex** (textureCache) | WebP texture blobs | IDB, cross-session | 0.6 × quota |
| **qs-mesh** (meshCache) | decoded mesh assets | IDB, LRU | 0.1 × quota (~1 GB) |
| **objectCache** | object data (preseed) | IDB | per-region |
| **server assetMemo** | transcoded WebP, in-memory | **lost on server restart** | 384 MB |
| **app/VRAM budget** (memGovernor) | textures + live geom + mesh cache (VRAM-bound) | — | `min(2048, 0.50×heap)`, +slider, override clamp 512–6144 |

Warm caches remove the **bake** cost (qs-geom) and the **grid-fetch + transcode** cost (qs-tex). They do
**NOT** remove the **main-thread build/apply** cost. That is the crux of "warm is still minutes."

---

## The pressure model (the single most important thing we learned)

There are **two different pressures with two different correct responses** — conflating them was the
root of multiple regressions this session:

| Pressure | Signal | CORRECT response | WRONG response (caused churn) |
|---|---|---|---|
| **VRAM / app budget full** | `appRatio > 1.0` | **Evict** farthest resident (draw-distance governor, near-protected) + prune far textures. Frees VRAM. | — |
| **Heap near OOM** | `memRatio > 0.95` (critical brake) | **Pause intake** (drain + texture/mesh fetch). Let GC reclaim the *transient bake/decode garbage* that fills heap. | **Evicting** the resident scene — it does NOT relieve heap (heap is garbage, not resident assets) and just churns the visible world to cubes + vanishes near textures. |

**Key insight:** on a cold dense load the heap is filled by **transient bake/decode garbage**, not the
resident scene (accounted resident ≈ 1 GB while heap hits 4 GB). So **eviction can never relieve heap** —
only pausing intake (so GC catches up) can. Evict on **VRAM budget only**; never on moderate heap.

**Draw-distance governor (`_effNear`):** shrink on `appRatio > 1.0` (VRAM full) or genuine 0.95 crisis;
grow back **only when app AND heap both have headroom** (`appRatio < 0.85 && heapRatio < 0.68`) — growing
on app-headroom alone re-grew dd into heap pressure every tick and wedged. Eviction is farthest-first
with a near-protected floor (32 m) so your immediate surroundings never get culled.

---

## Per-region matrix — what dominates, what helps

| Region | What dominates | What helps most |
|---|---|---|
| **Light, cached** | tiny object count → near-FS-fast | already good; near-first makes it feel instant |
| **Light, cold** | grid texture fetch (few) + bakes | texture fetch concurrency, server assetMemo warm |
| **Heavy, cached** | main-thread build of 24k + heap clamp evicting the mem tier → cache falls back to IDB | **near-first** (build/fetch surroundings first); off-thread build (deep) |
| **Heavy, cold** | EVERYTHING at once: bake garbage → heap brake; grid ~1/s × 4k textures → ~1 hr; main-thread build; VRAM evict | near-first + LOD + warm caches persisting so the *next* visit is "heavy cached" |

The "heavy cold" column is the worst case and is fundamentally grid-throughput + main-thread + 4 GB-heap
bound. The realistic strategy is: **load nearby first (feels fast), let the rest stream/persist, so the
re-visit is "heavy cached"** — and even that is main-thread-bound until off-thread building.

---

## Governing rules (invariants — don't regress these)

- **Evict on VRAM budget, never on moderate heap.** Heap pressure → pause intake (0.95 brake), not evict.
- **Texture fetch concurrency = 6.** The grid asset service *degrades* above this (fetch 0.4 s → 4.4 s at
  12-way); slow fetches cross the 25–30 s timeout → negative-cache → **never persist to qs-tex** (poisons
  warm caching). 6 = every fetch completes fast and warms the cache.
- **Write buffer hard-capped (256 MB).** Under saturation the byte-ceiling flush can't keep up; past the
  cap, skip persisting new keys (mem tier still serves them; they re-persist on a calmer visit).
- **Manifest is grow-only**, re-recorded on each settle edge → converges to the full working set without a
  fresh re-entry's partial slice shrinking it.
- **Budgets auto-scale off `jsHeapSizeLimit`** → work for everyone; sliders are opt-in tuning, clamped.
- **The load % / "major scenery to cache" badge measures geometry-nearby, NOT texture readiness** — it
  hits 100% while textures are still streaming (the "100% but cubes" report). A fix should reflect
  texture/mesh readiness of the near set.
- **#6 draw-call instancing is STOOD DOWN** — frustum culling already culls; draw calls were never the
  bottleneck. The cost is scene-graph traversal + the main thread (#11), not draw-call count.

---

## Shipped this session (2026-06-14)

1. Warm-read mem-tier prefetch + grow-only manifest (#10).
2. Critical-heap brake — `emergencyHeap` fires unconditionally > 0.95 so intake pauses on real heap (#11/#13).
3. Write-buffer hard bound 256 MB + log throttle (#13).
4. Texture fetch concurrency 12 → 6 (reliable warm-cache population).
5. Heap-aware draw-distance recovery gate (grow only when app+heap both clear) (#13).
6. Raised app/VRAM budget `min(2048, 0.50×heap)` + user override slider; geom-RAM-cache slider (#13).
7. Fix: evict on VRAM budget, not moderate heap (corrected #5's over-trigger that churned the scene).

Result: wedge/crash gone; loads are progressive and textured; warm helps. Remaining gap to FS = the two
hard ceilings.

---

## Next work (prioritized — value per effort)

1. **Prioritize-near** — ✅ IMPLEMENTED 2026-06-15 (uncommitted; see mem [[near-first-load-shipped]]).
   Build + texture + mesh + sculpt queues dispatch nearest-to-avatar first (min-heap + `nearRefDist`,
   child→root resolved). **Correct but its benefit is MASKED on mesh/heavy regions by #11 (texture
   read-starvation) + #13 (heap/LOD)** — confirmed live: cubes build instantly, the slow part is
   download completion (#11 starves it) and the region can't fit 4GB anyway (#13). So near-first won't
   *feel* better until #11 + #13 move in concert. **NEXT = #11 (off-main-thread IDB reads / throttle).**
2. **Refresh-textures button** (wire the disabled `ObjectContextMenu` stub) — force-reload a specific
   object's assets (clear negative-cache, jump the queue). Manual escape hatch when far things are deferred.
3. **Near-aware texture eviction** — `pruneTexturesLRU` must protect textures of near/visible objects so a
   dense over-VRAM-budget region doesn't drop the texture right next to you.
4. **Badge reflects texture/mesh readiness** of the near set, not just geometry % (fixes "100% but cubes").
5. **LOD** — low-detail instantly, refine in place (progressive, FS-style).
6. **Off-main-thread building** (OffscreenCanvas + worker render) — the deep fix for the #11 ceiling.
