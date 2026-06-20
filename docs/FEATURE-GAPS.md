# Feature Gaps & Priority Queue — quickerSTORM

> Living tracker. Add items freely during sessions, grouped by feature area.
> Both Gene and Claude read this before prioritizing work — completeness here means nothing gets forgotten.
> Status: `[ ]` not started · `[~]` partial · `[!]` needs live-test on a real grid

---

## Current Priority Queue

### Render / Cache (near-term)

> 📐 **READ FIRST: [docs/render-cache-model.md](render-cache-model.md)** — the unified model for how
> #6/#9/#10/#11/#13/#14 + textures interlock (2026-06-14). Two hard ceilings (single main thread, ~4 GB
> Chrome tab heap); evict on VRAM budget NOT heap; heap pressure → pause intake; warm caches remove
> bake+grid cost but NOT main-thread build cost; per-region matrix (cached/light/cold/heavy). **Next
> (prioritized): near-first ✅ → render-distance cull ✅ → refresh-textures btn ✅ → near-aware textures ✅
> → badge = texture-readiness ✅ → off-main-thread texture decode (#11 Pass 2) ✅ *(impl 2026-06-16,
> uncommitted, needs live-verify)* → **NEXT: LOD / raise draw-distance now decode is off-thread.** These items
> are NOT independent — a fix for one shifts the bottleneck to another; consult the model before picking work.

| # | Item | Status |
|---|------|--------|
| 1 | CRC probe audit | ✅ done 2026-06-12 |
| 2 | Storage budget (qs-geom 0.3/4GB, qs-mesh LRU 1GB) | ✅ done 2026-06-12 |
| 3 | Texture bulletproofing (watchdog + onabort everywhere) | ✅ done 2026-06-12 |
| 4 | Lit shading viability + render quarantine | ✅ done 2026-06-12 |
| 5 | OOM heap creep | ✅ suspect fixed; long-soak still needed |
| 6 | Draw-call instancing / merging | ⏸️ **STOOD DOWN 2026-06-14 — wrong bottleneck (v1 built, committed phase3, flag default-OFF, harmless).** Live data killed the premise: `renderer.info.render.calls` = **8–663 per frame** (frustum culling already culls the scene HARD), so DRAW CALLS WERE NEVER THE BOTTLENECK — the "9k/17k" was a census overcount (sums material slots, ignores frustum culling). The real `WebGLRenderer.render` self-time is scene-graph TRAVERSAL (`projectObject` over ~9k nodes), which instancing only cuts ~2× (geometry dedups poorly: light region 1.57 objs/geom, heavy 2.0). Per-instance UV REFUTED by fragmentation census (UV adds only ~3–6% of pool keys). v1 instancing works + renders correctly (alpha/lit/UV via cloned material; tint via instanceColor) but the win is modest (~1.5–1.6×) and pooled `frustumCulled=false` can even raise GPU submission. **The actual heavy-region pain is item #11 (main-thread saturation): 15.6k-obj region TP'd in, buildQ stuck ~13k, drain 3–16/s, `[Main]` longtasks total 126,835ms with a 5.9s freeze, frames=0, memory only 58% (NOT #13).** PIVOT to #11. Instancing telemetry lives in the `qsCensus()` DEV hook (relays via C.CLIENT_LOG → server log). See mem [[draw-call-instancing-shipped]]. ──── original 🔬 PROFILE 2026-06-13 (after #10 + #11-pass1 + avatars-index all landed): `WebGLRenderer.render` is the dominant frame cost — **~1540–3462ms self-time (12–22%)**, uncontested at the top of Bottom-Up once the avatars O(n²) was fixed. Per-prim meshes + MeshBasicMaterial (+ per-face material arrays). Needs brainstorm→spec: merge static prims by material into shared BufferGeometry and/or InstancedMesh for repeated shapes; interplay with per-prim culling (cullTick evict/reload), the geom cache, and per-face textures. Bigger structural project, not a patch. | (after #10 + #11-pass1 + avatars-index all landed): `WebGLRenderer.render` is the dominant frame cost — **~1540–3462ms self-time (12–22%)**, uncontested at the top of Bottom-Up once the avatars O(n²) was fixed. Per-prim meshes + MeshBasicMaterial (+ per-face material arrays). Needs brainstorm→spec: merge static prims by material into shared BufferGeometry and/or InstancedMesh for repeated shapes; interplay with per-prim culling (cullTick evict/reload), the geom cache, and per-face textures. Bigger structural project, not a patch. |
| 7 | Watch items / small debts | 🔜 planar-repeat striping, IDB version handlers, log spam |
| 8 | Prim geometry: ONE batched GEOM_VERSION bump | 🔜 hollow + path/profile cut + dimple + shear + revolutions, all at once |
| 9 | qs-geom pending-leak bricked scene build at ~3% (2026-06-13) | [~] Part A (leak-proof `_geomPending`, getMany watchdog) = live-verified win, builds clean, **uncommitted**. Part B (read-priority flush gate) = partial: writes land, no wedge, but warm `idb` hits still starved under burst. See mem: geom-pending-leak-bricks-drain |
| 10 | Heavy-region warm-read speed (2026-06-13) | **UPDATE 2026-06-14 — `idb=0` ROOT CAUSE CONFIRMED LIVE + mem-tier-prefetch fix landed (uncommitted, TDD+build green, NEEDS live-verify).** Killer evidence (zero-cost browser probes on warm qs-geom BEFORE any code, then live load): (1) 16,408 recs / 2.07GB persisted, GEOM_VERSION stable → persistence-deadlock theory (#13 part 2) **DISPROVEN**; (2) idle bulk read of 2405 manifest keys = 1337ms @99.9% hit, 200-key batch = 89ms → IDB healthy, keys match; (3) live warm load (NW Welcome 15.6k objs AND cold Aspen 48k): idb hits work for ~6s (idb=39→211) then **collapse to 0 permanently** while `wdog` climbs 6→359, `pend` pinned 301, `brkCap` breaks drain every tick; (4) `[Slow]` probe: only render blocks >250ms, and only LATE — NO >250ms task during the early collapse. **⇒ root = main-thread saturation (many sub-250ms tasks back-to-back) delays `getMany`'s completion past the 4s `GEOM_LOOKUP_WATCHDOG_MS` → batch degraded to re-bake → bake adds thread work+write → next batch also times out (watchdog AMPLIFIES the spiral). NOT persistence, NOT IDB latency, NOT key mismatch, NOT write-contention (collapse at 13s < 30s time-ceiling).** Warm re-entry ALSO collapsed because the manifest froze at 2405 keys vs ~11.8k working set. FIX (mem-tier prefetch = sync `geomMemGet`, immune to the saturated async IDB path): (a) `geomManifestRecord` no-shrink guard — only overwrite when strictly grown (geomCache.js); (b) engine re-records on every settle EDGE, not once (`_wasLoading` replaces one-shot `_manifestRecordedFor`, useWorldEngine cullTick) → manifest converges UP to full working set across settle dips/revisits; (c) `computeAutoGeomCacheMb` raises RAM mem-tier default ~384→~768MB on a 4GB heap (geomCache.js + uiStore.js), heap-pressure cap still guards OOM. 3 new TDD tests (geomCache 30/30), build:staging green. Deeper cold-load cross-region IDB-read collapse remains = true #11 (worker/offload). ──── [~] ✅ IMPLEMENTED 2026-06-13 (UNCOMMITTED; 149 lib tests + build:staging green; **NEEDS live-verify on a heavy WARM region**): write-deferral keystone (geomCache suspends IDB flushes while engine `setGeomCacheLoading(true)`, byte+time ceilings, debounced exit) + CPU-RAM geom cache (mem tier + write buffer) DECOUPLED from the 1536MB VRAM governor (dropped from BOTH setAppBytes sites → also frees VRAM budget for live geom = helps #13) + auto-detected (`navigator.deviceMemory`) + user-overridable RAM budget (`uiStore.geomCacheRamMb`, Prefs▸Graphics slider, 128–8192MB; also activated the Draw Distance slider stub) + per-region geomKey manifest recorded on settle & prefetched into mem tier on region entry (META store, no GEOM_VERSION bump). Files: byteLRU.js(setBudget), geomCache.js, uiStore.js, useWorldEngine.js, PreferencesFloater.vue. See plan+spec docs/superpowers/{plans,specs}/2026-06-13-warm-read-decouple*. ──── ORIGINAL DIAGNOSIS CONFIRMED: data IS cached & healthy (idle probe: qs-geom 3036 recs @87ms, qs-tex 13246 @77ms, qs-mesh 7873 @175ms) — NOT cold, NOT a cap problem. `idb=0` ONLY during load: `getMany` reads HANG under the bake/write storm (`wdog=487` accumulated; external count probe also times out >3s during load, but 87ms idle). So warm cache gives ~0 benefit exactly when needed → re-bake everything → 2-4min loads ("speeds up near end" = in-session MEM tier warming, not IDB). FIX = decouple reads from the write storm. APPROACH (brainstorm first): (a) FRONT-LOAD reads — at region entry issue geom-cache `getMany` for known keys BEFORE baking/writes, populate mem tier, so most prims serve from cache (few bakes→few writes→reads stay fast); (b) HOLD WRITES during the read-heavy phase — buffer geom writes (memory-bounded) and flush only after the initial build settles (stronger Part B without the FLUSH_MAX punch-through); must handle INCREMENTAL object arrival (keys not all known upfront → rolling). NOTE: Part B (`_readsInFlight` gate in geomCache `_flushNow`) already exists but FLUSH_MAX-forced flushes defeat it under heavy baking. |
| 11 | Heavy-region main-thread saturation (2026-06-13) — **DOMINANT HARD-RELOAD BOTTLENECK; PASS 2 + qs-tex WRITE-DEFERRAL DONE (uncommitted)** | **UPDATE 2026-06-16b (qs-tex WRITE-DEFERRAL, UNCOMMITTED, NEEDS LIVE-VERIFY):** Live `__texStats` after Pass 2 showed decode off-thread (`[Main] phases texbuild=3ms`, buildQ/uploadQ/decodeOutstanding all draining) but `queued` still climbed to thousands with `qWait avg ~20min` because `idb avg=7.4s` — the network-slot IDB recheck. ROOT (code-confirmed): `texCachePut` opened a `readwrite [STORE,META]` txn PER call (~1751/fill, each put+stats-get+count+maybe evict-cursor), and since they share STORE scope with the `readonly` `texCacheGet` reads, IndexedDB SERIALIZES every read behind the write convoy → 7.4s reads. NOT decode, NOT main-thread CPU (render dominates the thread). FIX = port the committed geom #10 write-deferral to `textureCache.js`: in-memory `_writeBuf` (coalesce, latest-wins) + ONE batched flush txn per window (count+evict once) + `setTexCacheLoading()` gate (suspend flushes during the fill burst, wired beside `setGeomCacheLoading` in useWorldEngine) + `_readsInFlight` read-priority gate + `texCacheGet` reads `_writeBuf` first + hardCap(128MB)/byteCeiling(64MB)/pagehide. `clearTextureCache` cancels timer+awaits in-flight flush (parity fix, caught in review — else "Texture refresh" mid-load resurrects cleared records). NO DB_VERSION bump. bun lib tests 208/0, vitest baseline unchanged, build:prod green. Dropped the earlier "time-box the recheck" lever (would only add refetches). Spec+plan: docs/superpowers/{specs,plans}/2026-06-16-tex-write-deferral*. LIVE-VERIFY: `idb avg` 7.4s→~ms, `queued` drains, `qWait` collapses, `[Drain] texWB=…MB` rises then flushes on settle. NEXT exposed = `render=703ms/window` (fps ceiling) → LOD track. See mem [[tex-write-deferral-shipped]]. ──── **UPDATE 2026-06-16 (Pass 2 IMPLEMENTED, UNCOMMITTED, NEEDS LIVE-VERIFY):** off-main-thread texture DECODE landed via subagent-driven plan (full suite: 0 new failures; `build:prod` green). New `src/lib/texDecodeBitmap.js` (pure `computeDownscale` + `decodeToBitmap` = createImageBitmap+OffscreenCanvas downscale, no THREE), `src/workers/texDecode.worker.js` (module worker, Blob→ImageBitmap transferred zero-copy, returns worker-side `decodeMs`), `src/composables/useTexDecoder.js` (mirrors useMeshBaker: single worker, dead-flag sync fallback, `outstanding()` backpressure, `RECYCLE_AFTER_JOBS`, `takeStats`). `useTextureFetch.js` pump split TWO-PHASE: `_dispatchDecodes` posts blobs to the worker (bounded by `DECODE_INFLIGHT_CAP=64`) + `_processUpload` drains decoded bitmaps to the GPU (`initTexture`) within the existing per-frame budget (upload-throttle survives the move). `b64ToBlob`/atob NOT moved (network-only, ≤6/s; warm region is all IDB blobs), single worker (no pool), no cache-version bump — all deliberate. `[Drain]` adds `texUpQ`/`texDec`. Spec+plan: docs/superpowers/{specs,plans}/2026-06-16-texture-decode-worker*. LIVE-VERIFY: `[Main] phases texbuild=` drops; fps holds while textures fill; `idb` avg eases from ~8–15s; tex orientation/alpha unchanged. See mem [[texture-decode-worker-pass2]]. ──── **UPDATE 2026-06-16: render ceiling (#13) FIXED via the visibility cull (render 1671–2546→127–968ms/win, ~5→55–90fps) + near-aware textures (appRatio intake gate fixed the `inflight:0 queued:4472` pump wedge; backfill/build skip cull-hidden) + tex-refresh/badge UI — shipped, committing. NEXT = off-main-thread DECODE worker (#11 Pass 2): with the pump unwedged, `createImageBitmap`+GPU upload + 15s IDB-read starvation peg the thread ~5fps and cap draw distance. See mem [[render-distance-cull-shipped]].** **UPDATE 2026-06-15 (COMMITTED): texture read-starvation TAMED → render (#13) is now the exposed ceiling.** Two roots fixed: (1) TexCache `GET_WATCHDOG_MS` 10s→30s so a slow-but-completing read RESOLVES THE REAL BLOB instead of false-missing→network — killed the ~2300-refetch/load storm (live: `⏱0` timeouts, ~10 trips vs thousands). (2) The main-thread hog this round was **our own near-first drain-order sort**: `orderByDistance` evaluated the distance fn INSIDE the sort comparator → ~2·n·log(n) Map-lookups → **~1.5s PER rebuild on a 20k buildQ, every 750ms** → `frames=0` (render starved), `built=1`. Fixed: precompute distance once (decorate-sort, O(n)) + drain-order TTL 750→2000ms. Live result: `drain 1533→~130ms`, `longtasks 6472→~100ms`, **`frames 0→~42fps`, textures fill**. Added `[Main] … phases:` per-phase main-thread attribution (DEV/disposable) — that's what pinned it. **NEXT CEILING = render (#13):** `phases render=1671–2546ms/window` dominates as objects build; far objects (~300m+) are drawn at `dd=192m` → scene-graph traversal cost → 3–6fps + springback (AgentUpdate starved). → LOD / cull-far-from-scene / off-thread render. See mem [[texture-read-starvation-tamed]]. ──── ✅ PASS 1 IMPLEMENTED 2026-06-13 (UNCOMMITTED; 154 lib tests + build:staging green; **NEEDS live-verify on a heavy hard reload**): texture build+upload throttle — `buildTexture` deferred OUT of `getBaseTexture` into a per-frame budgeted pump (`pumpTextureBuilds`, 32 builds/frame, `renderer.initTexture` uploads OFF the render() critical path), NEW `src/lib/budgetedDrain.js` helper, driven from `animate()`; `texBuildQ` on the `[Drain]` telemetry line. Consumers unchanged (resolve at pump rate). PASS 2 (next) = texture DECODE WORKER: move `b64ToBlob`(atob) + `createImageBitmap` + OffscreenCanvas downscale off-thread (mirror meshBake.worker.js); the upload-throttle survives that move. Watch: pump is focus-gated (buildQueue drains on refocus). Spec/plan: docs/superpowers/{specs,plans}/2026-06-13-texture-build-pump*. ──── 🔬 PROFILE 2026-06-13 (Chrome Perf, live hard reload, pass-1 active): TexCache watchdog trips **~1700 → 0** (texture read-starvation ELIMINATED, bare-texture symptom should be gone); max frame 1049→637ms; texBuildQ peaks ~52 drains immediately (pump keeps up). BUT main thread STILL saturated (~9fps, longtasks 53% of window, one 640ms task). Bottom-Up self-time NAMES the residual — and it is **NOT texture decode** (no createImageBitmap/drawImage/texImage2D/atob in the list → DECODE-WORKER PASS 2 DEFERRED, it would not have helped this): (1) **`WebGLRenderer.render` self ~1540ms** = draw-call traversal → render item **#6 (draw-call instancing/merging, ~9k calls)** is the big remaining cost; (2) **`worldStore.js:59 avatars computed` self ~1105ms** = O(n²) — the `avatars`/`prims` computeds `[...objects.values()].filter(...)` over ALL ~10k objects, invalidated on EVERY ObjectUpdate, re-read by reactive UI (AvatarList/MinimapOverlay/MapFloater) → thousands × O(10k). FIX (cheap, surgical, ~1.1s win): maintain incremental `_avatars`/`_prims` reactive collections in worldStore (add/remove by pcode on upsert) so the computed depends only on the small avatar set, NOT the whole objects map — prim updates stop invalidating it. NEXT ORDER: (a) avatars-computed incremental index ✅ DONE 2026-06-13 (uncommitted, 7 vitest + build green): worldStore now maintains `_avatars`/`_prims` index Maps in upsert/updateObjectPos/applyObjectProperties/remove/clearAll; `avatars`/`prims` computeds derive from those (depend only on the small per-kind set, not the 10k objects map) → prim churn no longer re-runs the avatar list. All external objects access is read-only so the index can't drift. NEEDS live re-profile to confirm the ~1105ms self-time is gone. (b) #6 draw-call reduction [BIG — now the #1 remaining cost at ~1540ms render self-time], (c) pass-2 decode worker only if decode resurfaces. ──── ORIGINAL: `animate()` rAF frames up to 1049ms during burst → ~1fps freeze-feel, springback, circuit drop, texCache watchdog ×1000. Overlaps render item 6 (draw calls) + memory pressure. ──── DECISIVE EVIDENCE 2026-06-13 (console read of live hard reload, post-#10 build): #10 geom write-deferral CONFIRMED engaged (`[GeomCache] deferred flush forced: time-ceiling 68→153MB buffered`) — write contention gone — YET `wdog=271` geom reads still timed out → re-baked ~150MB. **Natural experiment: write contention removed, reads STILL starve → root = main-thread saturation, NOT IDB write contention.** Co-conspirator: **~1700 TexCache watchdog trips (10s each)** in one load window — the texture decode/upload pipeline monopolizes the main thread, starving BOTH tex (10s) and geom (4s) read callbacks (different DBs, shared main thread). Hard-reload-of-everything = worst case; incremental "fly around" never saturates → felt fast (Gene confirmed). FIX DIRECTION (highest-leverage next): cut main-thread saturation — primary target the texture pipeline (1700 trips); options ranked: (a) move IDB cache reads (geom+tex) + ideally texture decode OFF the main thread into a Worker so completion callbacks don't queue behind render/decode jams (helps both caches, biggest win); (b) throttle/yield the texture createImageBitmap+GPU-upload pipeline so read callbacks interleave; (c) port #10 write-deferral to qs-tex (secondary — the geom experiment shows write contention is NOT the dominant cause, so this alone won't fix it). NOTE: even a perfect cache can't make a full-region hard reload instant — cache removes the BAKE cost, not the per-object upload/decode/render cost; goal is reads SUCCEED (no re-bake), which needs the main thread freed. |
| 12 | in NW Welcome region received raw system error in Nearby Chat possibly since we can't yet process LSL or LUA scripts?:  `Image Person 1: System.Reflection.TargetInvocationException: Exception has been thrown by the target of an invocation. ---> System.IndexOutOfRangeException: Index was outside the bounds of the array. at OpenSim.Region.ScriptEngine.Shared.Api.OSSL_Api.osGetGender (OpenSim.Region.ScriptEngine.Shared.LSL_Types+LSLString rawAvatarId) [0x000f1] in <e9b077f2a8774a708d4a7cb5428680ad>:0 at OpenSim.Region.ScriptEngine.Shared.ScriptBase.ScriptBaseClass.osGetGender (OpenSim.Region.ScriptEngine.Shared.LSL_Types+LSLString rawAvatarId) [0x00000] in <22ce70296409469b8dccf4049c2964f9>:0 at SecondLife.XEngineScript.default_event_http_response (OpenSim.Region.ScriptEngine.Shared.LSL_Types+LSLString request_id, OpenSim.Region.ScriptEngine.Shared.LSL_Types+LSLInteger status, OpenSim.Region.ScriptEngine.Shared.LSL_Types+list metadata, OpenSim.Region.ScriptEngine.Shared.LSL_Types+LSLString body) [0x00619] in <868f22a152ea41a79a77acb43550140b>:0 at (wrapper managed-to-native) System.Reflection.RuntimeMethodInfo.I From  <http://localhost:5174/#/world> `

| 13 | ⚠ GEOMETRY MEMORY RUNAWAY / cull-spiral regression (2026-06-13, LIKELY DOMINANT BUG) | UPDATE 2026-06-14 (live-tested a 48k-obj region): **(1) RAM-cache OOM crash FIXED + COMMIT-READY** — the geom CPU-RAM cache budget was sized off `navigator.deviceMemory` (1024MB), ignoring the ~4GB per-TAB heap, so RAM cache + resident geom + 48k worldStore OOM'd the tab (heap 107%→crash; app-budget only ~60% = heap>>app was the tell). Fix: `uiStore._autoGeomCacheMb` now heap-sized off `performance.memory.jsHeapSizeLimit` (~384MB on a 4GB tab); `geomCache.setGeomMemPressureCap` + cullTick runtime clamp (heap>0.82 & cache>96MB → 96MB floor; release <0.68) so the RAM cache can NEVER OOM the tab; write-deferral byte ceiling DECOUPLED from `_memBudget` (coupling bug) at 128MB. build+vitest(=baseline) green. See mem [[heavy-region-oom-and-read-starvation]]. **(2) STILL THE WALL = read-starvation `idb=0`** — geomCacheGetMany returns ZERO idb hits the whole load → every prim rebakes forever → garbage→heap→GC-thrash→blocks reads→more rebakes. NOT render (idb=0 at dd=32), NOT writes (forced-flush~0), NOT TP change ([Slow]=0). Strongest untested theory: **persistence deadlock** (writes deferred during load, flush only on settle; region never settles → never persists → next load can't hit → never settles). CHECK FIRST (idle qs-geom rowcount / one-shot getMany store-count+key-match probe) BEFORE coding; then fix = flush-progress-during-load (if persistence) or **IDB reads in a Worker** (#11, if populated-but-starved). **(3) start-low/ramp-gate draw-distance tweaks REVERTED** — backfired into eviction-churn heap-148% spiral (thrashing); back to the original governor (best observed = reached 90%). The real dense-region fixes remain #11 (worker) + LOD (option c below). ──── ORIGINAL: [~] FIX IMPLEMENTED (uncommitted, build+bun-tests green): dynamic draw distance — fixed `R_NEAR=96` replaced by governor-managed `_effNear` (useWorldEngine cullTick) that STEPS DOWN (−16m to a 32m floor) when over budget + nothing evictable beyond it (anti-wedge), and STEPS UP toward `uiStore.drawDistance` target with headroom (FS progressive-stepping equiv). Backed by `uiStore.drawDistance` (persisted, default 96) so a QuickPrefs/Prefs slider is an additive binding later. `[Mem] dd=Nm` telemetry added. (d) texture floor NOT built — `texMB=0` was a symptom of the wedge (pruneTexturesLRU ran every over-budget tick); should self-resolve once geometry evicts. ADDITIVE-LATER (not building twice — same knob): UI slider, FPS-based autotune (FS AutoTune ±10m off frame-time), start-low-on-TP progressive ramp, device-aware budget. FOLLOW-UP ✅ DONE (uncommitted): load badge `%` now relative to current draw distance `_effNear` (reaches 100% within what's actually loading); badge shows "nearby scene" while `_effNear` < target, "complete scene" at target, and prepends "Major new scenery to cache: " ONLY when a load has streamed continuously ≥ MAJOR_LOAD_MS(6000) — DURATION-based, not object count (count fired on every few-metre move even for cached areas; duration ignores quick cull-reloads). SceneLoadBadge.vue + worldStore.cullStats {atTarget, massive, effNear}. ──── DECISIVE EVIDENCE: over 18s on a dense region, `evicted` 928→1226 (MORE evicted) but `geomMB` 1213→1630 (geometry mem went UP) and `objs` 10493→9467 (FEWER objects) → **NOT a disposal leak** (CONFIRMED 2026-06-13: `removeMesh` disposes geometry+materials; `geomB` is a live per-tick scan of `meshMap`). ROOT CAUSE = **eviction policy can't recover under near-dense pressure**: `selectEvictions` (cullPolicy.js) is pure distance farthest-first with a hard `R_NEAR=96m` floor (`filter(c=>c.dist>minDist)`), no byte-awareness. On a dense region the geometry WITHIN 96m alone exceeds the 1536MB budget (`appBudgetBytes`); once everything beyond 96m is evicted, `selectEvictions` returns [] every tick while still over budget → permanent `⚠THROTTLING`, textures→0, wedge. "evicted↑ geomB↑ objs↓" = cheap far prims shed, heavy near mesh assets stay/build. Aggravators: NO LOD selection (highest-LOD everywhere = max bytes); no graceful degradation (governor doesn't shrink R_NEAR when it can't evict). FIX OPTIONS: (a) adaptive eviction floor — under sustained over-budget with nothing beyond R_NEAR, progressively lower the floor toward a hard min (~16m / avatars+edit+sit only) so the governor always makes progress; (b) byte-aware eviction ranking (evict heaviest first); (c) LOD selection (cut bytes/mesh — the long-term win); (d) texture-budget floor so textures don't starve to 0. App hit `2012/1536MB (131%) ⚠THROTTLING`, `texMB=0` (all textures sacrificed), samples byte-identical = wedged. Plausibly underlies the whole 2026-06-13 cluster: 13-min crawl, %-label oscillation (84→70→72), 1-fps freeze, circuit drops. NOT caused by Part A/B (those are geom *cache*, not mesh disposal/governor). Was supposedly fixed (mem: cull-death-spiral byteLRU + self-accounted memGovernor v2 + R_NEAR guard) — regressed or exceeded. R_NEAR tuning ALONE won't fix it. FIRST: confirm whether removeMesh disposes BufferGeometry + whether geomMB accounting decrements on evict. ──── Original (secondary) thrash note: `geomMB` pins the shared 1536MB budget → governor evicts + crushes texture cache 272MB→5MB (`tex cache` 1262→24) → texture re-fetch storm (`tex q=770`, texCache watchdog timeouts). Mesh build done (`buildQ=0`); the crawl is evict↔re-fetch churn. Levers: shrink `R_NEAR` (96m→48-64m); split geom-vs-texture budget (texture floor); investigate whether evicted-object geometry is fully disposed (geomMB stays pinned). User saw 84% in ~13min. SYMPTOM (user-visible): "nearby scene % loaded" label oscillates DOWN then up without traveling (84%→70%→72%) = governor evicting NEARBY/visible geometry then rebuilding. Label = Resident/Nearby (e.g. 2864/3978 within R_NEAR), NOT region-total (13255 received). Can't reach 100% because nearby-set geometry alone > budget. |

| 14 | Cross-region IDB retention tuning (2026-06-13) | [ ] IDB caps partition the origin quota by fraction: qs-tex **0.6** (~7.5GB — recurs + dedupes by asset UUID, spans dozens of regions, well-provisioned ✅), qs-geom **0.3** (~3.7GB, max 4GB), qs-mesh **0.1** (~1GB, tightest). Geometry/mesh tighter than textures — a few OUTLIER-dense regions (the 14k-obj one bakes ~1-2GB of unique geometry alone) can LRU-evict older regions → revisit re-bakes. Consider qs-geom 0.3→0.4 (tex has headroom). ⚠ INDEPENDENT of the warm-read-starvation blocker (#10): `idb=0` during load is reads HANGING under the write storm, NOT cap eviction (qs-geom had ~1.7k records, well under cap). Size this only AFTER the read-decouple lands; it only affects whether previously-visited regions stay warm. RAM-side cap that caused the throttle/wedge is the 1536MB memGovernor app budget (live scene), a separate layer. |

⚠ **Cache discipline rule:** All geometry-output changes land in ONE GEOM_VERSION bump (item 8) to avoid repeated user cache wipes. Do not land hollow alone, then cut, then shear — port the full PrimMesher.cs in one shot.

**Still open:** NoToneMapping A/B vs Firestorm — needs Gene's visual review.

- [ ] **Scene doesn't fully settle on a heavy COLD load (2026-06-16, captured — HEAP-BLIND GOVERNOR, = [[heap-blind-governor-cube-blowout]]).** Live `[Mem]` during the churn: `app 23–35%` (UNDER budget) but `heap 89%` (3.7/4.2GB, near-OOM); `buildQ=30593→42582` (mesh queue exploding); `objs 17471→5482` with `evicted=0` (a scene CLEAR/reset happened — auto-rebuild? — mid-churn); `tex cache 18↔1796` + `texMB 4↔419` (texture cache cleared then refills = the "textures climb over and over"); `geom wBuf=256MB drop=754→7580` (write buffer pegged at hard cap, dropping persists); `dd=32m` (governor pinned at the floor); thousands of `[Violation] requestAnimationFrame took ~100ms` (main thread saturated by mesh drain batches). **ROOT (confirmed): the governor throttles/evicts on `appRatio` (35% = "plenty of room") while the real pressure is HEAP (89%) — it's heap-blind, so it keeps ingesting/building 42k objects toward OOM; meanwhile something clears the scene and it reloads → churn. The texture climb + rAF violations are COLLATERAL of the mesh-load + heap saturation, NOT a texture-pipeline bug.** FIX direction (the documented next task; needs careful brainstorm — thrash-prone): (1) **heap-aware throttle** — pause/slow mesh BUILD + ingest when `memRatio()` is high (~>0.85), not only on appRatio; (2) find & stop the scene CLEAR that churns (likely an auto-rebuild firing under the wedge — `objs 17471→5482` evicted=0); (3) the geom `wBuf drop=7580` signals genuinely-cold over-volume — heap-throttling intake should relieve it. Only manifests on a heavy cold load (~17k+ objs). See [[render-cache-unified-model]], [[heap-blind-governor-cube-blowout]]. **→ FIX IMPLEMENTED 2026-06-16 (UNCOMMITTED / NEEDS LIVE-VERIFY):** heap-aware soft throttle — `memGovernor.heapThrottled()` (hysteresis 0.85/0.78, corroborated by `meshMap.size>500` so a hard-reload's inherited garbage can't blank the region) folded into `memUnderPressure()`; now gates the build drain (already), `pumpIngest` (new), and the texture pump (new), closing the 0.85–0.95 band that had no throttle below the 0.95 hard brake. Eviction still keys off `emergencyHeap()` only (pause intake, never evict on moderate heap — per the model). FIX direction (2) the scene-clear (`objs 17471→5482, evicted=0`) deliberately LEFT for a separate live-trace slice — may relieve as a side effect of stopping the climb. Spec/plan: `docs/superpowers/specs/2026-06-16-heap-aware-soft-throttle-design.md`, `docs/superpowers/plans/2026-06-16-heap-aware-soft-throttle.md`. 18/18 memGovernor tests green, build:prod green. **→ GRACEFUL-STABILITY FIX IMPLEMENTED 2026-06-18 (UNCOMMITTED / NEEDS LIVE-VERIFY) — fixes FIX-direction (2) at its root.** Live trace on cold "Never Depot" (10,888 objs) caught the collapse: `cullTick`'s `over = r>CULL_TARGET || emergencyHeap()` fired eviction + `pruneTexturesLRU` + the `_effNear` step-down on `emergencyHeap()` (heap>0.95) while `appRatio` was only **5%** (heap 99–103%, all transient garbage + build backlog, NOT the resident scene) → futile: `dd` cratered 192→32m, `texMB`→0, `objs` 704→275, and the evict→reload churn ballooned `buildQ` 171→600. FIX: eviction/prune/dd-step now key on the resident/VRAM budget (`appRatio`) ONLY via new pure `shouldEvictForBudget(appRatio, cullTarget)` (`emergencyHeap` dropped from the `over` clause + its import); and the dead-scene auto-rebuild is gated on `!memUnderPressure()` via `shouldAutoRebuild(deadScans, threshold, underPressure)` (a heap-paused scene isn't a dead scene). Heap pressure remains handled by the existing `memUnderPressure` intake/build pause (Change 3, unchanged). 5 new cullPolicy tests (218 lib green), build:prod green. Spec/plan: `docs/superpowers/specs/2026-06-18-heap-graceful-stability-design.md`, `docs/superpowers/plans/2026-06-18-heap-graceful-stability.md`. LIVE-VERIFY on a heavy cold region: heap PLATEAUS under the brake (no climb to 100%+), `dd` HOLDS (no `[Cull] … draw distance ↓` cascade to 32m), no texture wipe, no auto-`[3D] Rebuild Scene` while throttled. **→ FOLLOW-UP OOM-CLAMP 2026-06-18 (UNCOMMITTED): the graceful-stability fix exposed a latent OOM — a user app-budget OVERRIDE of 6144MB on a 4192MB-heap tab (live: Aspen 24k objs, app 85%/6144, heap 138%, evicted=0, tex stuck q=199 because the soft brake paused intake but eviction never fired since appRatio<1). The override max was a FIXED 6144MB that could exceed the heap limit → appRatio can't reach the 1.0 eviction trigger before heap OOMs. FIX: `memGovernor.appBudgetBytes` now clamps the override to `0.6 × jsHeapSizeLimit` via pure `resolveOverrideBudget` (heap-relative ceiling: ~2.5GB on a 4GB-heap machine, scales up on roomier ones; non-Chrome falls back to the fixed cap). Removing the heap-based eviction was SOUND only under the invariant budget ≤ heap-safe — this restores that invariant instead of re-adding the futile collapse. 23 memGovernor + 223 lib tests + build:prod green. Gene live-confirmed lowering the slider cleared the wedge; the clamp makes it automatic for everyone (incl. a maxed slider). **→ EXPOSED: HEAVY-REGION WEDGE (the real remaining #13/#11 wall, captured live 2026-06-18 on Aspen 24k objs / 4GB-heap tab — NEXT STRUCTURAL PROJECT, brainstorm first, do NOT reflex-patch).** With OOM now prevented, a 24k-object region is STABLE-BUT-DEGRADED: `_effNear` (eviction radius) floors at **32m**, `buildQ` FREEZES (~5029, identical across minutes), `evicted=1071`, heap PINNED 84-86% (soft brake stuck ON — never drops below the 0.78 release), `app 99%` of the clamped 2515MB. ~5000 objects never build; effective rendered radius ~32m (the visibility cull boundary is the stable ddTarget=192m, but eviction guts everything past _effNear=32m). MECHANISM (vicious cycle): heap = ~2515MB clamped assets + ~1050MB OVERHEAD (24k worldStore records + the frozen buildQ holding DECODED geometry + THREE scene) ≈ 85% → soft brake engaged → build drain paused → buildQ frozen → the frozen buildQ's decoded data IS part of the heap that keeps the brake on → never releases. The ~1GB fixed overhead (≈25% of a 4GB heap) is what squeezes the asset budget so hard that dd floors. TRADEOFF this surfaced: pre-clamp (6GB budget) rendered 400-500m beautifully then OOM'd; post-clamp renders a ~32m bubble stably — Gene misses the visibility. CANDIDATE LEVERS for the balanced fix (brainstorm): (1) **LOD** — cut per-object bytes so more fits the heap at higher dd (the long-term win); (2) **bound the build backlog** (deferred "Approach B") — stop holding ~5000 objects' decoded geometry resident so it stops pinning heap → brake releases; (3) **build-drain vs soft-brake interaction** — let the NEAR set build under the brake (eviction holds the budget) instead of freezing all builds → replaces the 32m wedge with a built near-set; (4) reduce per-object worldStore overhead. CONSTRAINTS: must NOT re-introduce OOM or the futile heap-collapse churn. GOAL: a 24k region renders a usable radius (>32m, toward 192m) without OOM. Clamp-fraction nudge (0.6→0.65) is a stopgap knob, not a cure (overhead is the squeeze). **→ LEVER 3 IMPLEMENTED + LIVE-VERIFIED 2026-06-19 (UNCOMMITTED): the *frozen-buildQ* part of this wedge was a soft-heap-brake LATCH bug, now fixed.** `memGovernor.heapThrottled()` stands down + clears its latch when `appRatio() ≥ SOFT_HEAP_APP_STANDDOWN (0.85)` — when the resident scene already explains the heap, the appRatio eviction controller owns it and the self-releasing `emergencyHeap()` backstops OOM. The old latch keyed only on `residentCount>500`, so a settled region (heap pinned ~0.80 by the LIVE scene, above the 0.78 release) froze builds forever even though that heap was not reclaimable garbage. Live PASS: 0 soft-heap throttles post-reload, builds drained through the 0.89 band that used to latch (buildQ 14567→6816), eviction stepped dd 224→112m gracefully (no 32m crater), 24k region built ~9775 objs at dd 112m (vs old 80m). memGovernor.js only (+4 TDD tests, 227 lib green, build:prod green); spec `docs/superpowers/specs/2026-06-19-heap-brake-resident-standdown-design.md`; mem [[heap-brake-resident-standdown]]. **RESIDUAL (the real remaining project, unchanged):** the heaviest 24k region now settles STABLE+non-OOM at heap 94–95% / dd 112m with ~6816 far objs unbuilt — held by the emergencyHeap (0.92) brake because the ~1.5GB fixed overhead + capped resident pins heap near OOM (eviction can't shed overhead). This is the LOD / bound-build-backlog / cut-overhead work — Lever 3 was not meant to solve it. Goal "usable >32m without OOM" MET (112m); toward 192m = LOD next.
- [ ] **Build/Edit texture preview shows a broken/404 image (2026-06-16, minor)** — `ObjectEditFloater` caches blob object URLs in its own `texUrls` map; when the texture is evicted (`pruneTexturesLRU` / "Evicted for memory safety") or refreshed, `useTextureFetch` calls `URL.revokeObjectURL` on the cached URL, leaving `texUrls` holding a dead `blob:` URL → the `<img>` fails to load. Blob is still in qs-tex IDB. Fix-forward: add `@error` on the preview `<img>` to null + re-resolve via `getTextureUrl` (re-reads IDB → fresh URL), self-healing. Also note: `loadTex` early-returns if `uuid in texUrls`, so a uuid that resolved null once never retries (separate staleness — preview stays blank after the texture later loads). **→ MOSTLY FIXED 2026-06-17:** the `@error`→`reloadTex` self-heal was already in; the residual console `blob:…ERR_FILE_NOT_FOUND` was the memory-pressure `pruneTexturesLRU` revoking a preview's object URL out from under the floater. FIX: prune no longer revokes objUrls (object URLs exist only for previews; prune's RGBA-freeing goal is unaffected; revoke stays in `refreshTextures`/`clearTextureCache`). Residual: manual "Texture refresh" while previewing the same texture still self-heals via `@error` (rare, user-initiated). The `loadTex` resolved-null-no-retry staleness is still open (minor).
- [ ] **Cold-region texture load is the dominant usability wall (2026-06-17, live-measured — = #11 / [[render-cache-unified-model]] "heavy-cold = grid-throughput bound").** Measured on a typical DENSE 256m region (~4,626 objs, genuinely cold: server restarted + new region so both client qs-tex IDB and server assetMemo cold). Timeline from arrival: all geometry/shapes built ~1.5 min (`buildQ`→0 fast, bake worker idle ~0.4ms/job — geometry is NOT the bottleneck); textures fully drained (`tex q`→0, 2212 cached) ~**13 min**; meshes still trickling past that. Heap peaked only **24%** — the heap brake correctly never fired (this validated [[next-tasks-queue]] slice-1: silent + no churn/rebuild/regression on a real cold load, but UNexercised — needs the 17k+ 1024-var class to fire). **Bottleneck = the asset fetch+transcode pipeline:** grid fetch **2–3 s/asset**, transcode pool only **w=4**, sustained ceiling **~15 textures/min**, PLUS a **~5-minute dead stall up front** (server asset success ≈0–1/min for the first ~5 min, 13:29–13:34) — the single biggest lever (if textures flowed from t=0 at even the steady rate we'd save ~5 min; suspect mesh/sculpt contention for the shared 4-worker pool, slow-fetch head-of-line blocking, or client under-dispatch). Plus steady `http_404` waste (assets the grid lacks → wasted fetch + permanent cubes). NEEDS its own investigation (systematic-debugging/brainstorm), SEPARATE from the shipped governor brake.
- [ ] **Some textures never fill on a settled scene; manual "Texture refresh" recovers a few → want IDLE-TIME AUTO-BACKFILL (2026-06-17, Gene live).** After the scene settles, a chunk of textures stay missing (404s + missed/dropped fetches + negative-cache). Navigating or per-object **Texture refresh** (`ObjectContextMenu → requestTextureRefresh → refreshObjectTextures`, clears failure/cache + negative-cache, re-applies) fills a few in each time — confirming many are recoverable, just not retried. **Idea (Gene): once the scene goes IDLE (buildQ 0, tex q drained, CPU/longtask quiet), automatically run the "Texture refresh" retry for ONLY the still-missing/white faces region-wide** — a background gap-filler so the user doesn't have to manually poke objects. NOTE there is already a `_texBackfillTimer` (re-applies to still-white meshes + drives fetch retries) — investigate why it doesn't recover these (does it clear the persisted negative-cache like manual refresh does? does it gate on idle? does it cover 404-retry?). Likely small, high-perceived-value. Confirmed 2026-06-17: the "few missing" persist even on a WARM revisit → they were never successfully cached (404 / dropped), warm can't conjure them.
- [ ] **512m VAR-REGION bugs on "Aspen Homesites" (2026-06-18, Gene live) — position snaps to Y=255 + terrain missing.** Three symptoms, all var-region-specific (region is 512×512; clamps/terrain assume 256): **(a) intra-region TP snaps to Y=255** — ✅ FIXED 2026-06-18 (UNCOMMITTED): `server/handlers/lludp.ts` `C.MAP_TELEPORT` handler hardcoded `min(255,d.x/y)`; raised to the **8191** var-region sanity bound to match the `C.TELEPORT` handler above it (which was already fixed — MAP_TELEPORT was simply missed). NEEDS live-verify (reconnect, intra-TP past Y=255 lands correctly). **(b) WALKING past Y=255 also snaps back** — SEPARATE clamp, location NOT yet found (not MAP_TELEPORT; likely a client dead-reckoning / movement position clamp or a server AgentUpdate echo — trace next). **(c) terrain disappeared** (after hard reload, and again after Resync World) — server log shows Aspen receiving ONLY `[terrain] WATER_FLOOR patches=2` (0x37) — NO LAND patches (a 512 region should send a 32×32 land grid); land-terrain decode/arrival for this var region is producing nothing → flat/absent terrain. Relates to [[var-region-terrain-fix]] (LandExtended 0x4D, 32-bit patch IDs) + [[var-region-map-fixes]]. NOT caused by today's heap/badge changes (those don't touch terrain or position clamps; heap fix makes eviction LESS aggressive). The "stuck at 543 remaining textures" Gene saw first was on the pre-reload OLD bundle (cleared by hard reload). NEXT: fix (a) [small — regionSize clamp], trace (b), investigate (c) land-patch decode on 512 regions.

### Cold-asset-pipeline work — lined up 2026-06-17 (start on #1), all serve the proven "warm = ~13–20s usable" strategy
Live cold-vs-warm on Requiem (dense 256m, 4626 objs): **cold ~13 min** (texture grid-fetch bound), **warm ~13–20 s** (~60× faster, `tex q=0` all from qs-tex IDB, build 390/s from qs-geom). So the whole problem is the COLD/first-visit asset path. Three items + a quick win:
1. **⭐ START HERE — Server-side persistent (disk) asset cache (Tier-2).** Today `assetMemo` is in-memory + lost on restart (I restarted the server → this test was double-cold). A disk-backed cache on the VPS/NAS ([[hosting-target]]) means grid fetch+J2C→WebP transcode happens ONCE ever; every later client / visit / server-restart gets the pre-transcoded WebP instantly → most "cold" clients load in ~1–2 min instead of 13. Biggest lever for cold. Brainstorm → spec → plan → subagent-driven. **→ IMPLEMENTED 2026-06-17 (UNCOMMITTED / NEEDS LIVE-VERIFY):** `server/lib/assetDiskCache.ts` (bun:sqlite blob LRU + short-TTL negative-404 cache; all public ops internally try/safe → never breaks serving) wired read-through behind `assetMemo` in `server/handlers/assets.ts` (disk get → negative check → grid fetch+transcode → disk put / putNegative-on-404-only). Env: `ASSET_DISK_CACHE`(=0 disables), `ASSET_DISK_CACHE_PATH` (.cache/assets.sqlite), `ASSET_DISK_CACHE_BYTES` (8GB), `ASSET_DISK_NEG_TTL_MS` (6h). `[AssetMemo]` log now carries `disk hits/miss/MB/size/evict/neg`. 10 module tests + full server suite (163) green, bundles clean. Spec/plan: docs/superpowers/{specs,plans}/2026-06-17-tier2-disk-asset-cache*. LIVE-VERIFY: cold-load a region (watch `disk miss=` climb + `.cache/assets.sqlite` grow), RESTART server, revisit SAME region → `disk hits=` dominates, grid `[Asset]` lines drop, load collapses toward ~1–2 min.
2. **Investigate the ~5-min front stall + throughput** (see the cold-region item above): why ~0 texture transcodes/min for the first ~5 min (mesh/sculpt contention for the shared w=4 pool? slow-fetch head-of-line blocking? client under-dispatch — server pool showed idle workers, inflight 1–3 of 4?), and whether pool workers / dispatch can lift the ~15 tex/min ceiling. **→ ROOT-CAUSED + FIX IMPLEMENTED 2026-06-17 (UNCOMMITTED / NEEDS LIVE-VERIFY):** the stall was CONTENTION, not throughput — `useInventory.fetchAll()` greedily walks the whole inventory tree at caps-ready, processing big INV_FOLDER batches on the client main thread (live `[Main]`: ~2 fps, `longtasks=32 total=3854ms`/window) for ~7 min, starving region texture/mesh load (server decode pool IDLE, fetches <1s; throughput jumps ~25× the instant inventory finishes at 13:35). FIX: publish `worldStore.sceneLoading` from `cullTick`; the fetchAll pump defers via pure `shouldDeferInventoryWalk(sceneLoading, elapsed, FETCHALL_DEFER_CEILING_MS=240s)` until the region's assets drain (on-expand fetches stay immediate). Expected cold load ~13min → ~4min (textures then run server-bound with a free main thread). 6 new vitest tests + build:prod green. Spec/plan: docs/superpowers/{specs,plans}/2026-06-17-defer-inventory-bulk-walk*. LIVE-VERIFY: cold-load → `[Inv]` doesn't begin until assets drain, `[Main]` longtasks low early, texture throughput steady from the start (no 5–7min stall).
3. **Idle-time texture auto-backfill** (see item above) — auto-retry still-missing textures region-wide once idle.
- **QUICK WIN — raise the qs-geom IDB disk cap on capable machines.** `GEOM_CACHE_MAX_BYTES=4GB` is the qs-geom **IndexedDB (disk)** cap — NOT heap, zero OOM risk (≠ the ~768MB heap-bound mem tier). Effective = `min(0.3×quota, 4GB)`; quota ~11.6GB → ~3.48GB binds now (4GB hard cap not yet active). Raise the hard cap (helps once quota>~13GB) + consider `navigator.storage.persist()` for a larger durable quota + scale fractions by free disk → more regions stay warm cross-session = more instant revisits. Small, safe.

- [ ] **WebGL `glCopySubTextureCHROMIUM` / "invalid mailbox name" / "texture is not a shared image" errors (2026-06-17, ROOT-CAUSED — REAL, not dev artifact).** Console spam: `GL_INVALID_OPERATION: invalid mailbox name` / `texture is not a shared image` / `GL_INVALID_VALUE: glCopySubTextureCHROMIUM: Source texture is not a valid texture object`. **Confirmed real:** persists across hard reloads AND a Vite restart (so not HMR/stale-module). **ROOT CAUSE:** the texture decode worker ([[texture-decode-worker-pass2]], `texDecode.worker.js`) creates **GPU-backed `ImageBitmap`s** — the `createImageBitmap(OffscreenCanvas)` downscale path in `texDecodeBitmap.js` — and **transfers** them to the main thread (`postMessage({bitmap},[bitmap])`); uploading a worker-context GPU shared-image bitmap on the MAIN-thread WebGL context fails in Chrome (the shared-image/mailbox belongs to the worker's GPU context). Most textures hit the downscale path → most uploads error, Chrome falls back (CPU readback) so the scene still mostly renders (Gene: "looks pretty good, few missing textures"). IMPACT: (a) console noise, (b) a few genuinely-failed uploads = missing textures, (c) likely a per-upload perf cost (failed GPU copy → fallback) that partly undercuts the Pass-2 off-thread-decode win. **FIX (designed, not yet built):** worker decodes to CPU pixel data — `OffscreenCanvas.getContext('2d').getImageData()` → transfer the RGBA `ArrayBuffer` — and the main thread uploads a `THREE.DataTexture` (CPU data has no mailbox/shared-image, so no cross-context failure); keeps decode off the main thread. Handle Y-flip/straight-alpha (currently baked via createImageBitmap options) in the CPU path. NOT scene-breaking; do when convenient. **→ FIXED + LIVE-VERIFIED 2026-06-17 (UNCOMMITTED):** worker now decodes to CPU RGBA via `decodeToPixels` (`getImageData`, transfers the buffer); main thread uploads a `THREE.DataTexture` (`pixelsToTexture`, with explicit Linear+trilinear-mipmap filters since DataTexture defaults to Nearest/no-mips). Y-flip baked via `imageOrientation:'flipY'` → getImageData row0=image-bottom=DataTexture t=0 (correct orientation, live-confirmed); straight alpha preserved. WebGL errors GONE, textures fast + correct orientation/sharpness/alpha (Gene: "looks 99% good"). Chain: `texDecodeBitmap.js`/`texDecode.worker.js`/`useTexDecoder.js`/`useTextureFetch.js`. 9 decoder/decode-lib tests + build green.

### Phase 3 Feature Priority

1. Inventory management — move/rename/wear/attach (LLUDP, no AIS3 in OpenSim)
2. Friends live-test — verify contacts tab against a real grid; close the debt row
3. Places floater completion — gear menu actions, TP history accordion, Favorites bar
4. Object interaction: Take / Delete / Copy (perms + caps)
5. Profile: live-test + edit own fields
6. Neighboring-sim terrain (EnableSimulator + second circuit)
7. Voice gateway wire-up (spatial pan, VAD, per-region enable)
8. Prim geometry completeness — the single GEOM_VERSION bump (render item 8)
9. Groups + Group IM (ChatSessionRequest + LLUDP hybrid)
10. Appearance / bake pipeline — risky, needs test-grid validation first
11. Environment (WindLight/EEP sky, day cycle, reflections, shadows)
12. Media (sounds, parcel audio, object texture video)

---

## Feature Gaps by Area

---

### Movement & Physics

- [ ] Invisible-object phantom collisions — stray bumps with no visible object
- [ ] Walk "start-over" bug in busy areas — avatar resets mid-walk, likely a late-obstacle detection race
- [ ] Cross-region boundary walk — DisableSimulator + new UseCircuitCode handshake not wired; map dot lags; no scene continuity on walk
- [ ] **Drop-through-floor (recurring, big) (2026-06-13)** — avatar falls through terrain and/or floor objects. LIVE CLUE: terrain decode is processing `typeB=0x37` patches as `WATER_FLOOR` (h≈0m) while avatar stands at z≈22m; if a 0x37 patch overwrites real land height at the avatar's patch, collision floor drops to ~sea level. See the 0x37 sea-floor drop-guard (mem: terrain-decoder-missing-patches) — a 0x37 patch may be slipping past it on this region/layout.
- [ ] **Springback type-2: walk → fast repeated camera bounce → snapped back, sometimes drops through floor (2026-06-13)** — distinct from type-1 (below). LIVE CLUE: `→ MOVE cf=0x1` packets ARE sending and `TerseUpdate ownId` corrections keep arriving; the bounce is client-predict vs sim-not-honoring-the-step, then authoritative snap-back. Likely COUPLED to the floor-drop (falling → corrected → bounce). Also noticed: `worldStore.avatarPos` is empty `{}` (own-avatar live pos not tracked in store) → weak client reconciliation.
- [~] **"No avatar / can't move / can only cam" on reload** — ✅ ROOT-CAUSED + FIXED + live-verified 2026-06-15 (server-only, UNCOMMITTED; see mem [[no-avatar-resume-fix]]). Cause (b) "own-avatar never created" = **session resume loses the avatar**: on page reload the Bun circuit is held alive → resume branch (replayCachedWorld), but the sim only broadcasts the own ScenePresence ObjectUpdate once (after the ORIGINAL CompleteAgentMovement) and IGNORES a duplicate → avatar never re-arrives → `ownAvatarLocalId` null, movement blocked. TP fixed it because it's a real sim re-arrival. FIX: server captures the own-avatar ObjectUpdate (`sessions.ts ownAvatarUpdate`, `lludp.ts` pcode47+fullId match) and re-sends it on **`OBJ_PROBE_RESYNC`** (the client's post-mount "engine listening" signal — the replayCachedWorld burst fires pre-mount so its avatar frame is lost) + resync.ts replay for the manual button. localId is session-stable → live TerseUpdates reconcile. ⚠ Cause (a) heavy-load main-thread-saturation freeze (rAF up to 1049ms, circuit drops) is SEPARATE and may remain — overlaps #11.

---

### Avatar Rendering

- [ ] Baked skin / clothing textures — full AgentSetAppearance bake pipeline; ⚠ sending empty bake data destroys appearance globally, needs test-grid validation before wiring
- [ ] Rigged mesh skeleton (skin block decode) — bone transforms ignored; clothing meshes land at wrong positions
- [ ] Clothing / attachment rendering — currently blocky robot; bind-pose placement first, then hide arm tubes only on torso-coverage signal (not on attachment count)
- [ ] Own-avatar appearance mesh from baked textures

---

### Objects: Prims

All shape params already decoded server-side. The following are geometry-generation gaps only.

- [ ] Hollow (ProfileHollow) — renders solid where it should be open; hollow cylinder localId 1051985899 fills in open-water deck mesh
- [ ] Path cut (PathBegin/End)
- [ ] Profile cut (ProfileBegin/End)
- [ ] Dimple
- [ ] Shear
- [ ] Revolutions / skew
- [ ] Hole-shape variants (interior face geometry and UV)
- ⚠ All items above → one GEOM_VERSION bump (priority queue item 8)
- [ ] Per-face materials on hollow/cut interior faces
- [ ] Delivery variance — occasional missing prims on heavy regions
- [ ] Linkset root-name polish (root prim name shown in hover / selection)
- [ ] Hovering an object after 1-3 seconds delay should show light info tip exactly like FS does. Name, owner, phantom, prims/LI, pos, dist.  Hard to tell FS behavior - sometimes extra delay maybe it's retrieving (why not cache this info?) and some objects don't have it (I think locked ones mainly??)

---

### Objects: Mesh

- [ ] LOD selection — always uses highest-LOD submesh; should select by screen-space size
- [ ] Rigged / skinned mesh (SkinWeights + JointNames block, bind pose)
- [!] qs-mesh LRU at 1GB cap — confirm eviction and re-bake work correctly on a long session
- [~] **Mesh pipeline wedges → placeholder CUBES on warm region (2026-06-19, ROOT-CAUSED + FIX UNCOMMITTED, needs live-verify).** Live (Bountiful Sandbox, warm, after a heavy 24k load + cross-sim TP): `[ClientDiag] placeholders=792 … mesh inflight=12 q=779` FROZEN for minutes, server `[Mesh]` decode log dead since the circuit swap, `⏱0` (no timeouts), `buildQ=0` so NO load badge. ROOT: `meshCacheGet` (qs-mesh IDB read) hung — a silently-stuck readonly txn fires no success/error/abort and `meshCacheGet` had NO watchdog (only `onabort`; geom/tex got watchdogs, mesh was missed). `useMeshFetch.run()` does `active++` then `await meshCacheGet()` BEFORE arming its 30s network timer, so a hung read holds an in-flight slot with no timeout and never emits `MESH_FETCH` → 12 hangs exhaust `MAX_INFLIGHT=12` → 779 queue frozen → 792 cubes. NOT the heap fix (heap 45–57%, standdown is a no-op there). FIX: 30s `GET_WATCHDOG_MS` on `meshCacheGet` mirroring `texCacheGet` (frozen read → declare miss → network fetch); `getMeshWatchdogTrips()` telemetry. meshCache.js + test, 228 lib + build:prod green. Watchdog itself not unit-testable in fake-indexeddb (same as tex twin) → live-verify recovery. FOLLOW-UP (deferred, one-fix-at-a-time): `useMeshFetch` holds the in-flight slot DURING the cache read (active++ before an unguarded await) — moving the read out of the slot makes recovery instant vs 30s. Mem [[mesh-cache-watchdog-cube-wedge]]. Also surfaced: the load badge should track the mesh-asset queue, not just prim buildQ (observability gap — cubes loaded silently).

---

### Objects: Trees / Plants / Particles

- [ ] System trees and plants (PCode 0x01 / 0x04) — 0%; need billboard or fixed geometry treatment
- [ ] flexi, flutter anim?
- [ ] Particle systems (PSBlock) — fields decoded but skipped; need THREE.Points emitter per object; extended 192-byte OpenSim format causes tail-OOB on some prims
- [ ] Particle Editor / Inject, Particle Explorer, Rip

---

### Object Build & Edit Floater

Working: Object Properties, in-scene TransformControls drag, MultipleObjectUpdate, per-face texture mapping display with Repeats-per-meter. General tab: name, description, UUID, type, hover text, creator/owner/lastOwner/group UUIDs, creation date, click action (read-only), touchName/sitName, for-sale + sale type + price (read-only), permissions (CMTX letters). Object tab: locked/physical/temporary/phantom flags (read-only, from PrimFlags + ownerMask), localId, parentId, link count, position/size/rotation, prim shape params.

- [ ] Edit name and description
- [ ] Edit permissions
- [ ] Numeric size / pos / rot input fields (in-scene drag works; text input TODO)
- [ ] Texture drag and drop onto faces
- [ ] Select Face radio (target individual face for texture/material edits)
- [ ] Normal / Specular channels (RenderMaterials cap exists; not consuming yet)
- [ ] Sculpt texture assignment
- [ ] Create new prim in-world
- [ ] Link / Unlink prims
- [ ] **Link number wrong (2026-06-19)** — we compute link order by sorting children by LocalID; correct source is `ObjectProperties.LinkNumber` (U32). e.g. child localId 955628720 shows as link 47 vs FS link 67 in the same 154-prim linkset. Fix: decode and store `LinkNumber` from ObjectProperties; use it instead of sorted position.
- [ ] Object face raycast picking — currently picks bounding box; need per-triangle for correct face selection
- [ ] Open / unpack box contents (RequestTaskInventory + Xfer)
- [ ] Take, Delete, Copy to inventory (perms + Phase 3 caps)

---

### Right-Click Menus

**Hover cursor system (done 2026-06-19):** hand cursor on hover over touchable objects (handleTouch PrimFlags bit 0x80, or clickAction 1–6); badge icon next to cursor for Sit/Buy/Pay/Open/PlayAnim/Zoom; crosshair when Edit floater open; left-click fires sendTouch when hand cursor active; Buy/Pay suppressed on child prims; Touch disabled in context menu for clickAction=7.

**Avatar menu (~40% — IM, View Profile, Face Toward, Texture Refresh done):**
- [ ] Zoom to avatar
- [ ] Call (voice)
- [ ] Invite to group
- [ ] Inspect (appearance info)
- [ ] Save outfit
- [ ] Self: open AppearanceFloater, Sit/Stand, Fly/Land, community actions

**Object menu (~40% — Edit, Inspect, Touch + hover-cursor + left-click-touch + Texture Refresh done; Touch disabled for clickAction=7):**
- [ ] Sit on object (SitOnObject + RequestObjectPropertiesFamily)
- [ ] Take, Delete (Phase 3 caps)
- [ ] Buy / Pay (if object is for sale / L$ enabled)
- [ ] Create copy to inventory
- [ ] Open (object contents via Xfer)

---

### Terrain & Environment

- [ ] **0x37 WATER_FLOOR patch may overwrite real land height (2026-06-13)** — `typeB=0x37` patches decoded as `WATER_FLOOR` (h≈0m) on a region where avatar ground is z≈22m. Suspected root of the drop-through-floor bug (see Movement & Physics). The historical fix was "drop 0x37 sea-floor layer"; verify the guard still fires for this region's `single-type-byte` layout (logs showed `layout=single-type-byte`, two-type gave overrun).
- [ ] Neighboring-sim terrain — adjacent ±regionSize regions (EnableSimulator + second circuit or cap fetch)
- [ ] Region size on cross-region TP — RegionHandshake lacks size; var-region warps assume 256×256; needs cap fetch
- [ ] 4 detail terrain textures — UUIDs already in hand; need J2C fetch + corner-blend shader application
- [ ] Sun / moon directional light (position derived from environment time-of-day)
- [ ] Sky gradient (horizon/zenith colors from WindLight/EEP)
- [ ] Water reflections
- [ ] Shadows
- [ ] Day / night cycle (time-of-day state from sim EstateCovenantReply or EEP)
- [ ] Wind field visual consumer (LayerData 0x57 already decoded; no renderer yet)
- [ ] Cloud layer visual consumer (LayerData 0x43 already decoded)

---

### Nearby Chat

- [ ] Chat transcript / scrollback persistence (session storage)
- [ ] Muted names / words filter
- [ ] Options panel (chat range, channel override, font size)
- [ ] Search within history
- [ ] Tear-off to separate draggable floater
- [ ] Close / re-open without losing history

---

### Instant Messaging / Conversations

Working: send + receive, emoji picker + recent, per-agent tabs.

- [ ] Standard toolbar buttons — Mute, Share, Pay, TP Offer, Add Friend, Block, Profile, and several more
- [ ] Voice button in IM window
- [ ] Group IM tabs (distinct from direct IM — see Groups section)
- [ ] Conference / ad-hoc multi-agent chats
- [ ] Typing indicator (ImprovedInstantMessage type 41)
- [ ] IM history persistence across page reloads

---

### Friends / Contacts

Working: contacts tab, search, online/offline list, rights toggles, add-by-name, remove, IM from contact.

- [!] Not live-tested — verify on a real grid; remove `friends-live-verify` from tech-debt.md after
- [ ] Map-permission toggle (see friend on map / let friend see you)
- [ ] Modify-objects permission toggle
- [ ] Call friend (voice)
- [ ] Teleport to friend / Offer TP
- [ ] Per-friend online-notification option

---

### Inventory

Working: folder tree, lazy expand + background bulk load, item browse, count footer, type icons, search, filter/sort tabs, right-click properties.

- [ ] Drag / move items to another folder
- [ ] Rename item (F2 or context menu)
- [ ] Wear / attach from inventory (calls to sim)
- [ ] Detach / remove wearable
- [ ] Thumbnails (GetTexture for asset preview image)
- [ ] Create new item
- [ ] Create folder
- [ ] Change permissions
- [ ] Transfer / drop to another agent
- [ ] Accept from another agent
- [ ] "Folder of 42" / CMT batch operations
- [ ] Play inventory assets inline (sounds, animations, gestures — locally and in-world options)
- [ ] Find / filter duplicate UUIDs
- [ ] Inventory localStorage cache (persist folder tree across login sessions)

---

### Appearance / Outfits

Working: edit avatar colors/skin/hair (local display only), Wearing tab, Outfits tab shell.

- [ ] Baked textures / clothing layers (full AgentSetAppearance bake pipeline) — ⚠ risky, needs test-grid
- [ ] COF (Current Outfit Folder) sync with wearables store
- [ ] Client-side texture bake (compose layers on canvas 2D → upload)
- [ ] Wear / unwear items from Wearing tab
- [ ] Outfits: save, apply, delete

---

### Places Floater

Working: Favorites list, Landmarks, TP history, basic Teleport button.

**Gear / context menu gaps:**
- [ ] Show on Map
- [ ] Share landmark
- [ ] View / Edit landmark (thumbnail + Title + My Notes)
- [ ] Move to Favorites
- [ ] Copy SLurl
- [ ] Cut, Copy, Paste, Rename, Delete
- [ ] Expand folder
- [ ] Remove from history (history entries only)

**History tab gaps:**
- [ ] Accordion grouping by date (Today, Yesterday, This Week…) with manual collapse
- [ ] alt+H toggle
- [ ] Per-entry: Copy SLurl, Remove, Clear all, show position + date

**Favorites / Landmarks gaps:**
- [ ] Drag to reorder Favorites
- [ ] Favorites Bar strip in the main HUD
- [ ] Landmark detail view + Edit (Title + My Notes)
- [ ] Plus-btn menu: LM current location, Create folder, Sort by date

**List UI gaps:**
- [ ] Filter bar
- [ ] Detail view with Back button, Teleport, Show on Map, region image

---

### Map & Minimap

Working: pan, zoom-toward-cursor, click-select, dbl-click TP, search with auto-retry, maturity badges, heading-up rotating minimap.

- [ ] Real region snapshot tiles (J2C fetch via cap)
- [ ] Remove the arbitary grid lines
- [ ] MapItemRequest for agent / event / landmark dots
- [ ] Friends layer (online friends shown on map)
- [ ] Go Home wired to home position from login response - why not already?
- [!] Minimap CoarseLocationUpdate forwarding (dropped at lludp.ts:630) — region-wide dots unreliable beyond draw distance; needs server work
- [ ] Minimap land markers (parcel bitmask overlay)
- [ ] Map localStorage cache (persist region records between sessions)

---

### Voice (WebRTC)

Working: peer signaling, WS proxy layer.

- [ ] Gateway wire-up (Vivox / Freeswitch or Opus-native SIP)
- [ ] Spatial audio pan (distance + direction from avatar position)
- [ ] VAD (voice activity detection) tuning
- [ ] Per-region / per-parcel voice enable from sim flags
- [ ] Per-speaker mute and volume slider
- [ ] Voice active indicator on avatars and minimap dots

---

### Media

- [ ] Object / script sound triggers (SoundTrigger, AttachedSoundGainChange packets)
- [ ] Parcel ambient audio stream (parcel media URL)
- [ ] Object texture video (mp4 / stream on prim face via ObjectMedia cap)

---

### Profile

Working: profile floater via avatar-properties cap (~60%).

- [!] Not live-tested on a real grid ? what do you mean?  It shows, but is so minimal I wouldn't call it a test until ready
- [ ] Edit own profile fields (about, first life, web URL, languages)
- [ ] Upload / change profile photo
- [ ] Picks tab (create / edit / delete picks)
- [ ] Classifieds tab (view)
- [ ] Notes about other agents
- [ ] Resident-since / payment-info flags

---

### Groups & Group IM

- [ ] Group list from login (AgentGroupDataUpdate)
- [ ] Group info floater (charter, members, roles, land, notices)
- [ ] Group IM (ChatSessionRequest cap + ImprovedInstantMessage hybrid)
- [ ] Group notices (inbox + send)
- [ ] Group roles / membership management
- [ ] Active group title toggle
- [ ] Group search

---

### Scripting & Object Behaviors

- [ ] Touch handler dispatch to script (llTouch → script event)
- [ ] Animated rotation scripts (spinning prims via ObjectUpdate pose stream) - is this partial yet?
- [ ] Script-driven texture changes - helpful
- [ ] General LSL event dispatch (touch, collision, sensor, timer…)
- [ ] High-use LSL functions (llGiveInventory, llTeleportAgent, llDialog…)

---

### Web-on-Prim

- [ ] ObjectMedia cap decode (media URL per face)
- [ ] HTML iframe rendered on prim face (CSS3D plane or canvas texture)

---

### Cross-Cutting / Misc

- [!] NoToneMapping A/B vs Firestorm — Gene same it seems okay but we don't have real lighting
- [!] Heap long-soak — OOM suspect fixed 2026-06-12; needs ~2-hour session to confirm flat
- [!] Var-region terrain live-verify (NeverWorld 512m fix committed 2026-05-30, not yet confirmed on a running grid)
- [ ] CoarseLocationUpdate server forwarding (lludp.ts:630 drop — affects map + minimap dots)
- [ ] Springback type-1 investigation (avatar snaps back when walking or flying, perhaps gets ahead of server, fixed a few times but it comes back). NOTE 2026-06-13: under heavy-load saturation, `AgentUpdate` sends are starved → sim never registers the move → next `TerseUpdate` snaps back. See also Movement & Physics springback type-2 (the fast-bounce + floor-drop variant).
- [ ] RenderMaterials normal/specular on prims (cap infrastructure exists; not consuming yet)
- [ ] Enhancement: find/filter inventory items by duplicate UUID
- [!] **texCache watchdog timeouts under heavy load (2026-06-13)** — `[TexCache] get watchdog (10000ms) → miss … trip #1000` during heavy-region burst; texture IDB reads starved (separate DB from qs-geom). Watch whether it's main-thread saturation starving the read callbacks vs real IDB contention.
- [ ] **Missing textures on specific objects post-#10 (2026-06-13)** — after the warm-read decouple (#10) landed, geometry loads+clears within seconds (✅ Gene flew the region), but some objects render untextured. LIVE CLUE localIds: **473189211, 473186194** + several others. UPDATE 2026-06-13 (console-confirmed): root is **main-thread saturation (#11)**, NOT (primarily) texCache write contention — the texture decode/upload storm (~1700 TexCache 10s-watchdog trips in one hard-reload window) jams the main thread so texture read callbacks starve → bare objects. So porting #10 write-deferral to qs-tex ALONE will NOT fix this (see #11 natural-experiment evidence). Real fix = free the main thread (move IDB reads/decode to a Worker, or throttle the texture upload pipeline). STILL worth checking per-asset: if a specific UUID stays permanently bare even when idle, that one is a J2C fetch/decode failure (check server log), distinct from the storm-starvation. See [[warm-read-decouple-shipped]].
- [!] **App/tab asset-memory creep (2026-06-13)** — `[Mem] app ~81% of 1536MB` (texMB+meshCacheMB+geomMB+geomCacheMB) on a 5.3k-object region; climbs across reloads on a long-open tab. NOT a separate gauge — lives in the Chrome tab, inflates process RAM (Gene saw high system RAM 2026-06-13 AM, suspected the long-open MCP tab). Watch it doesn't hit the cap on big regions.
- [ ] **Circuit drop on heavy/slow load (2026-06-13)** — remote sim `DisableSimulator` ~3 min after connect; likely client-too-busy (saturation) starving `AgentUpdate`/keepalive. Caps how far a cold heavy region gets before reload. Co-factor with render item 11.
- [~] **TELEPORT into heavy region wedges + stuck on "Arriving" (2026-06-14)** — ✅ FIX IMPLEMENTED 2026-06-14 (UNCOMMITTED; `build:staging` green ×4, vitest identical to baseline = NO new failures; **NEEDS live-verify on a heavy-region TP**). Two corrections to the analysis below, found by reading the code: (1) the overlay never gated on buildQ — it cleared only on the *2nd* `AgentSpawnPos` (fragile handshake, starved/absent under the flood); (2) `buildQ 28k vs objs 12.9k` is NOT a leak — `objs` in telemetry is `meshMap.size` (built), and `preseedRegionCache` dumps the whole warm IDB cache into `pendingMeshIds` in one sync loop. Real freeze = the SYNCHRONOUS per-batch work in `onObjectUpdate` (persist + upsert loops) + the one-shot preseed loop blocking rAF. FIX (all in useWorldEngine.js): **(a)** client ingest pump — `onObjectUpdate` pushes prims to `_ingestQueue` (avatars stay inline); `pumpIngest()` on the 30ms drain interval does upsert+persist+queue-add via `drainWithinBudget` (512/6ms, raises when hidden); `preseedRegionCache` enqueues instead of looping; queue cleared on TP/unmount; `persistObjects` deleted (folded into pump). **(b)** Arriving overlay — `_tpSettleTimer` (2.5s) clears once the destination avatar is placed (covers single-spawn-pos grids), `_tpArrivalTimer` (12s) hard failsafe → silent clear if placed, else FS-style "taking longer" toast; cancelled on confirm/fail/region/unmount. Region membership unchanged (TeleportFinish=committed, TeleportFailed=stay). Spec/plan: docs/superpowers/{specs,plans}/2026-06-14-tp-ingest-backpressure-and-arriving-gate*. ──── ROOT-CAUSED via timed() probe (commit bb8992a, relays `[Slow]` >250ms). The TP path wedges where a COLD RELOAD of the same region does NOT (reload → `buildQ→0`, completes; TP → `buildQ` explodes 25,715→28,004 and climbs, `frames=0`, never finishes). **It's an ObjectUpdate FLOOD, not a slow function:** NO `[Slow]` fired (drain/cull/reparent/render all <250ms — probe ruled them out); the main thread is dominated by `obj_upd` decode (`n=303, 191ms/window`, max 80–98ms each) — the sim sends objects faster than the client builds. Memory is fine (39%, geomMB=86) so NOT #13; longtasks max only ~395ms (the original one-off 5.9s was likely first-region shader-compile/GC, not the steady wedge). Two sub-bugs: **(a)** no client-side pacing/backpressure on region-cross ingestion (buildQ unbounded — possibly old-region meshes not cleared on TP compounding it: buildQ 28k >> objs 12.9k); **(b)** the "Arriving" overlay gates on FULL load so it never clears under the flood — should clear once the scene is usable (avatar placed + nearby built), not at buildQ=0. Co-factor: lots of TexCache watchdog trips (texture reads starved by the obj_upd-saturated main thread). This is the real-user heavy-region pain (TP, not reload). Refines render item #11. probe (timed()) + qsCensus hooks still in tree (DEV, disposable).
