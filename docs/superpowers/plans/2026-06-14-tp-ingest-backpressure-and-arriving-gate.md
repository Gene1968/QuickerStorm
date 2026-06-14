# TP Ingestion Backpressure + Arriving-Overlay Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the ObjectUpdate flood from freezing the main thread on TP-into-heavy-region, and make the "Arriving" overlay clear reliably.

**Architecture:** Two independent changes in `src/composables/useWorldEngine.js`. (A) A frame-budgeted *ingest pump* moves prim `upsertObject`/persist/queue-add off the synchronous WS-handler path into the existing 30ms drain interval, reusing `src/lib/budgetedDrain.js`. (B) The Arriving overlay gains a short post-spawn settle timer + a hard fallback timer so it clears once the avatar is placed, never hangs.

**Tech Stack:** Vue 3 composable, Three.js, IndexedDB object cache (`@/lib/objectCache.js`), `drainWithinBudget` helper (already unit-tested).

**Testing note:** `useWorldEngine.js` is a Three.js/DOM composable with no unit harness — its wiring is verified by `npm run build:staging` (ESLint is broken repo-wide; build + vitest are the gates, per `docs/CONVENTIONS.md` and the eslint-broken memory) plus Gene's live-verify on a heavy region. The reusable pure logic (`drainWithinBudget`) is already covered by lib tests. No new composable unit tests are fabricated. **Commits:** per Gene's standing rule, the implementer does NOT commit — leave changes staged/unstaged for Gene, who commits himself. Draft commit subjects (≤50 chars) are provided for his use.

**DEV probes:** the `timed()` (`[Slow]`) and `qsCensus()` hooks stay in tree (disposable) — they are how this gets live-verified.

---

## File Structure

- **Modify:** `src/composables/useWorldEngine.js`
  - Add import of `drainWithinBudget`.
  - Add `_ingestQueue` state + `pumpIngest()`; wire into the 30ms drain interval.
  - Rewrite the prim path in `onObjectUpdate` to enqueue instead of process inline; move avatar `upsertObject` inline.
  - Rewrite the `preseedRegionCache` loop to enqueue.
  - Delete the now-unused `persistObjects` function + its call.
  - Add `_ingestQueue.length = 0` to the two scene-clear sites (TP finish, unmount).
  - Add overlay timer state + `clearTpTimers()` + `onTpArrivalTimeout()`; wire into `onTeleportFinish`, `onAgentSpawnPos`, `onTeleportFailed`, and teardown.

No other files change.

---

## Task 1: Add the ingest queue + pump (Part A core)

**Files:**
- Modify: `src/composables/useWorldEngine.js` (import ~line 24; state ~line 296; pump near `drainMeshQueue` ~line 3463; drain interval ~line 4140)

- [ ] **Step 1: Add the import**

At line 24, the existing import is:
```js
import { objCachePut, objCacheGetAll, objCacheCrcMap, objCacheEvict, objCachePruneRegions, objCacheFlush, objCacheClearRegion } from '@/lib/objectCache.js'
```
Add immediately below it:
```js
import { drainWithinBudget } from '@/lib/budgetedDrain.js'
```

- [ ] **Step 2: Declare the ingest queue**

Find (line ~296):
```js
	const pendingMeshIds = new Set()  // localId → awaiting mesh build (prims only; avatars build inline)
```
Add directly below it:
```js
	// Region entry / TP floods ObjectUpdates faster than the main thread can upsert+persist them
	// synchronously (FEATURE-GAPS #11 / TP-into-heavy wedge). Raw prim objects land here and are
	// drained by pumpIngest() on the paced drain interval so the WS handler never blocks rAF.
	const _ingestQueue = []  // { o, persist } — persist:false for preseed (already cached)
```

- [ ] **Step 3: Add `pumpIngest()`**

Find the start of `drainMeshQueue` (line ~3463):
```js
	function drainMeshQueue() {
```
Insert ABOVE it:
```js
	// Frame-budgeted ingestion: pull prim objects off _ingestQueue and do the upsert + (optional)
	// persist + mesh-queue-add that onObjectUpdate used to do synchronously. Runs on the 30ms drain
	// interval (CPU work, focus-independent). Builds are still gated separately in drainMeshQueue.
	const INGEST_BUDGET_MS = 6
	const INGEST_MAX = 512
	function pumpIngest() {
		if (!_ingestQueue.length) return
		const hidden = (typeof document !== 'undefined' && document.hidden)
		drainWithinBudget({
			queue: _ingestQueue,
			maxItems: hidden ? 4096 : INGEST_MAX,
			budgetMs: hidden ? 250 : INGEST_BUDGET_MS,
			processOne: ({ o, persist }) => {
				worldStore.upsertObject(o)
				if (persist) {
					// Persist the MERGED record (never the raw update) — same semantics as the old
					// persistObjects: a partial update must not overwrite a complete cached record.
					const key = regionCacheKey()
					if (key) objCachePut(key, { ...(worldStore.objects.get(o.localId) ?? {}), ...o })
				}
				// Evicted linksets stay evicted on inbound updates (data persisted, mesh not queued —
				// cullTick reloads the whole linkset when near). Same guard as the old inline path.
				if (!(evicted.has(o.localId) || evicted.has(o.parentId ?? 0))) {
					pendingMeshIds.add(o.localId)
				}
			},
			onError: (e, item) => {
				upsertMeshFailures++
				if (upsertMeshFailures <= 5 || upsertMeshFailures % 25 === 0) {
					debugStore.push('warn', `[3D] ingest fail #${upsertMeshFailures} localId=${item?.o?.localId}: ${e.message}`)
				}
			},
		})
	}
```

- [ ] **Step 4: Wire `pumpIngest` into the drain interval**

Find (line ~4140):
```js
		_meshDrainTimer = setInterval(() => {
			_lastDrainTickAt = performance.now()   // animate()'s starvation detector reads this
			timed('drain', drainMeshQueue)
			timed('pumpTex', pumpTextures)   // resume governor-paused texture fetches once heap pressure clears
			if ((_drainTick++ & 3) === 0) timed('reparent', reparentOrphans)
		}, 30)
```
Change to (add the `ingest` line FIRST so objects exist before their meshes are pulled):
```js
		_meshDrainTimer = setInterval(() => {
			_lastDrainTickAt = performance.now()   // animate()'s starvation detector reads this
			timed('ingest', pumpIngest)   // paced upsert/persist/queue (TP-flood backpressure, #11)
			timed('drain', drainMeshQueue)
			timed('pumpTex', pumpTextures)   // resume governor-paused texture fetches once heap pressure clears
			if ((_drainTick++ & 3) === 0) timed('reparent', reparentOrphans)
		}, 30)
```

- [ ] **Step 5: Build**

Run: `npm run build:staging`
Expected: build succeeds (the pump is wired but not yet fed — `onObjectUpdate` still uses the inline path until Task 2; the queue is simply empty so `pumpIngest` no-ops).

---

## Task 2: Route live ObjectUpdates + preseed through the queue (Part A wiring)

**Files:**
- Modify: `src/composables/useWorldEngine.js` (onObjectUpdate ~2335 & ~2416–2438; preseed ~543–549; delete persistObjects ~576–588)

- [ ] **Step 1: Rewrite the prim path in `onObjectUpdate`**

Find (line ~2416):
```js
		for (const obj of objs) {
			worldStore.upsertObject(obj)
			// WHY (perf): defer prim mesh creation to the paced per-frame drain so a big
			// ObjectUpdate batch doesn't block the WS message handler. Avatars are few and the
			// own-avatar logic below drives the camera, so build those inline immediately.
			if (obj.pcode !== PCODE_AVATAR) {
				// Memory-evicted linksets stay evicted on inbound updates: the data is persisted above
				// (worldStore + IDB) but the mesh is NOT queued — otherwise a moving far object rebuilds
				// every update and the culler re-evicts it next tick (churn), and a root resurrected here
				// would come back WITHOUT its children. cullTick reloads the whole linkset when near.
				if (evicted.has(obj.localId) || evicted.has(obj.parentId ?? 0)) continue
				pendingMeshIds.add(obj.localId)
				continue
			}
			try {
				upsertMesh(obj)
			} catch (e) {
```
Replace through the `upsertMesh(obj)` call with:
```js
		for (const obj of objs) {
			// WHY (perf): prims are deferred to the paced ingest pump so a big ObjectUpdate batch
			// can't block the WS handler / rAF (FEATURE-GAPS #11 / TP-into-heavy wedge). The pump
			// does upsertObject + persist + mesh-queue-add. Avatars stay inline — own-avatar
			// attribution + the follow camera below depend on the object existing immediately.
			if (obj.pcode !== PCODE_AVATAR) {
				_ingestQueue.push({ o: obj, persist: true })
				continue
			}
			worldStore.upsertObject(obj)
			try {
				upsertMesh(obj)
			} catch (e) {
```
(Everything after `upsertMesh(obj)` — the catch block and the own-avatar logic — is unchanged.)

- [ ] **Step 2: Remove the synchronous `persistObjects(objs)` call**

Find (line ~2335):
```js
		const objs = payload?.objects ?? []
		persistObjects(objs)
		objUpdateCount++
```
Change to:
```js
		const objs = payload?.objects ?? []
		objUpdateCount++
```
(Persist now happens per-object in `pumpIngest`.)

- [ ] **Step 3: Confirm `persistObjects` has no other callers, then delete it**

Run: `grep -n "persistObjects" src/composables/useWorldEngine.js`
Expected: only the function definition (~576) remains (the call was removed in Step 2).

Then delete the function. Find (line ~573):
```js
		// WHY: persist each non-avatar object as it arrives/updates. Per-object upsert (no
		// whole-region overwrite) so a session that re-sees fewer objects cannot shrink the
		// cache. Avatars are transient (not cached).
		function persistObjects(objs) {
			const key = regionCacheKey()
			if (!key) return
			for (const o of objs) {
				if (o.pcode === PCODE_AVATAR || typeof o.localId !== 'number') continue
				// Persist the MERGED record, never the raw update. A partial update (e.g. compressed
				// without ExtraParams) carries no meshId/sculptId; putting it raw overwrites a complete
				// cached record with a gutted one, and the CRC probe-hit then replays the gutted version
				// forever (the sim thinks we have it — a mesh roof came back as a torus). Mirrors the
				// {...existing, ...incoming} merge worldStore.upsertObject does right after.
				objCachePut(key, { ...(worldStore.objects.get(o.localId) ?? {}), ...o })
			}
		}
```
Delete that entire block (the merged-record semantics are preserved in `pumpIngest`).

- [ ] **Step 4: Rewrite the `preseedRegionCache` loop to enqueue**

Find (line ~543):
```js
			const cached = await objCacheGetAll(key)
			let n = 0
			for (const o of (cached ?? [])) {
				if (o.pcode === PCODE_AVATAR || typeof o.localId !== 'number') continue
				if (worldStore.objects.has(o.localId)) continue
				worldStore.upsertObject(o)
				pendingMeshIds.add(o.localId)
				n++
			}
```
Replace with:
```js
			const cached = await objCacheGetAll(key)
			let n = 0
			for (const o of (cached ?? [])) {
				if (o.pcode === PCODE_AVATAR || typeof o.localId !== 'number') continue
				if (worldStore.objects.has(o.localId)) continue
				// Paced through pumpIngest like live updates — a warm region's full cache (~28k) must
				// not upsert in one synchronous loop. persist:false: these came FROM the cache.
				_ingestQueue.push({ o, persist: false })
				n++
			}
```
(The crcMap seeding immediately below — `_crcMapKey` / `_crcMapP` — stays synchronous and unchanged; the probe pipeline needs it immediately.)

- [ ] **Step 5: Build**

Run: `npm run build:staging`
Expected: build succeeds. Live data + preseed now flow through `pumpIngest`.

---

## Task 3: Clear the ingest queue on scene teardown (Part A lifecycle)

**Files:**
- Modify: `src/composables/useWorldEngine.js` (onTeleportFinish ~2698; unmount ~4419)

- [ ] **Step 1: Clear on cross-region TP**

Find (line ~2698):
```js
		pendingMeshIds.clear()  // perf: drop queued mesh builds on region change
		evicted.clear()
```
Change to:
```js
		pendingMeshIds.clear()  // perf: drop queued mesh builds on region change
		_ingestQueue.length = 0  // drop the old region's un-ingested prim backlog
		evicted.clear()
```

- [ ] **Step 2: Clear on unmount**

Find (line ~4419):
```js
		pendingMeshIds.clear()  // perf: drop queued mesh builds on unmount
		evicted.clear()
```
Change to:
```js
		pendingMeshIds.clear()  // perf: drop queued mesh builds on unmount
		_ingestQueue.length = 0
		evicted.clear()
```

- [ ] **Step 3: Build**

Run: `npm run build:staging`
Expected: build succeeds.

Draft commit subject for Part A (Gene commits): `perf(tp): paced ingest pump for ObjectUpdate flood`

---

## Task 4: Arriving-overlay timers (Part B)

**Files:**
- Modify: `src/composables/useWorldEngine.js` (state ~648; onTeleportFinish ~2679; onAgentSpawnPos ~2599–2654; onTeleportFailed ~2755; teardown ~4419)

- [ ] **Step 1: Add timer state + helper**

Find (line ~648):
```js
	let _tpSceneCleared = false  // true after onTeleportFinish clears scene; cleared by first AgentSpawnPos
```
Add directly below it:
```js
	// Arriving-overlay gate: the avatar is placed on the first AgentSpawnPos, but the overlay
	// historically waited for a 2nd packet that can be starved (flood) or never sent (some grids).
	// _tpSettleTimer clears the overlay shortly after the avatar is placed; _tpArrivalTimer is the
	// hard failsafe so it can never hang. Region membership is unchanged (TeleportFinish = committed).
	let _tpSpawnApplied = false   // a non-zero destination spawn pos applied since TeleportFinish
	let _tpSettleTimer = null
	let _tpArrivalTimer = null
	const TP_SETTLE_MS = 2500
	const TP_ARRIVAL_MS = 12000
	function clearTpTimers() {
		if (_tpSettleTimer) { clearTimeout(_tpSettleTimer); _tpSettleTimer = null }
		if (_tpArrivalTimer) { clearTimeout(_tpArrivalTimer); _tpArrivalTimer = null }
	}
	function onTpArrivalTimeout() {
		_tpArrivalTimer = null
		if (uiStore.teleportStatus !== 'arriving') return
		clearTpTimers()
		uiStore.teleportStatus = ''
		if (_tpSpawnApplied) {
			debugStore.push('warn', '[3D] TP arrival: spawn applied but no confirming AgentSpawnPos within 12s — clearing overlay')
		} else {
			// Option (b): committed to the destination (TeleportFinish swapped the socket) but it
			// never spoke. Tell the user why the screen cleared into a sparse scene; we can't undo it.
			notificationStore.notify({ title: 'Teleport', body: 'Teleport is taking longer than expected…', icon: '⏳', toast: true })
			debugStore.push('warn', '[3D] TP arrival timeout: no destination spawn pos within 12s — clearing overlay')
		}
	}
```

- [ ] **Step 2: Start timers + reset flag in `onTeleportFinish`**

Find (line ~2679):
```js
	function onTeleportFinish(d) {
		uiStore.teleportStatus = 'arriving'
		_tpSceneCleared = true
```
Change to:
```js
	function onTeleportFinish(d) {
		uiStore.teleportStatus = 'arriving'
		_tpSceneCleared = true
		_tpSpawnApplied = false
		clearTpTimers()
		_tpArrivalTimer = setTimeout(onTpArrivalTimeout, TP_ARRIVAL_MS)
```

- [ ] **Step 3: Clear timers on the fast (2nd-packet / local-TP) overlay clears**

Find (line ~2606):
```js
		if (_tpSceneCleared) {
			_tpSceneCleared = false   // consumed: source sim responded, still waiting for destination
		} else if (uiStore.teleportStatus === 'arriving') {
			uiStore.teleportStatus = ''  // second SpawnPos = destination confirmed
		} else {
			uiStore.teleportStatus = ''
		}
```
Change to:
```js
		if (_tpSceneCleared) {
			_tpSceneCleared = false   // consumed: source sim responded, still waiting for destination
		} else if (uiStore.teleportStatus === 'arriving') {
			uiStore.teleportStatus = ''  // second SpawnPos = destination confirmed
			clearTpTimers()
		} else {
			uiStore.teleportStatus = ''
			clearTpTimers()
		}
```

- [ ] **Step 4: Mark spawn-applied + start the settle timer once the avatar is placed**

Find (line ~2630, after the mid-walk suppression early-return):
```js
		avatarSLPos = [...p]  // WHY: own copy — dead reckoning mutates in-place
		worldStore.setAvatarPos(x, y, z)
		worldStore.setSpawnPos(x, y, z)  // also update persistent store for future remounts
```
Add directly below those three lines:
```js
		// Overlay: the avatar is now placed in the destination. Clear shortly even if the confirming
		// 2nd AgentSpawnPos never arrives (single-spawn-pos grids). Only engages during a cross-region
		// TP (onTeleportFinish set 'arriving' + the hard timer); same-region/local TP is untouched.
		if (uiStore.teleportStatus === 'arriving') {
			_tpSpawnApplied = true
			if (_tpSettleTimer) clearTimeout(_tpSettleTimer)
			_tpSettleTimer = setTimeout(() => {
				_tpSettleTimer = null
				if (uiStore.teleportStatus === 'arriving') { clearTpTimers(); uiStore.teleportStatus = '' }
			}, TP_SETTLE_MS)
		}
```

- [ ] **Step 5: Clear timers on `TeleportFailed`**

Find (line ~2755):
```js
	function onTeleportFailed(d) {
		uiStore.teleportStatus = ''
		_tpSceneCleared = false
```
Change to:
```js
	function onTeleportFailed(d) {
		uiStore.teleportStatus = ''
		_tpSceneCleared = false
		_tpSpawnApplied = false
		clearTpTimers()
```

- [ ] **Step 6: Clear timers on teardown**

Find (line ~4419, the unmount block edited in Task 3):
```js
		pendingMeshIds.clear()  // perf: drop queued mesh builds on unmount
		_ingestQueue.length = 0
		evicted.clear()
```
Change to:
```js
		pendingMeshIds.clear()  // perf: drop queued mesh builds on unmount
		_ingestQueue.length = 0
		clearTpTimers()
		evicted.clear()
```

- [ ] **Step 7: Build**

Run: `npm run build:staging`
Expected: build succeeds.

Draft commit subject for Part B (Gene commits): `fix(tp): robust Arriving-overlay clear + timeout`

---

## Task 5: Final verification

- [ ] **Step 1: Full build**

Run: `npm run build:staging`
Expected: succeeds, no errors.

- [ ] **Step 2: Lib tests still green**

Run: `npx vitest run`
Expected: existing suite (incl. `budgetedDrain` tests) passes; no regressions.

- [ ] **Step 3: Hand to Gene for live-verify**

Live checklist (heavy region, DEV `timed()` + `qsCensus()` active):
- TP into the heavy region: `frames` > 0 throughout, no multi-second freeze, `[Slow]` stays quiet, scene completes like a cold reload. Run `qsCensus()` after it settles for the before/after picture.
- Overlay: clears promptly on arrival. On a deliberately slow/silent destination, the hard timer clears it (silent if the avatar was placed; soft "taking longer" toast if it never was).
- Regressions: same-region (local) TP and a rejected/failed TP both behave as before (failed → stay in old region + toast).

---

## Self-Review

- **Spec coverage:** Part A (ingest pump) = Tasks 1–3; Part B (overlay gate) = Task 4; testing/verify = Task 5. The spec's "delete persistObjects", "crcMap stays sync", "avatars inline", "queue cleared on TP+unmount", "settle + hard timer", "option (b) notify", "cancel on failed/region/unmount" are all covered.
- **Placeholder scan:** none — every code step shows full before/after.
- **Type/name consistency:** `_ingestQueue`, `pumpIngest`, `INGEST_BUDGET_MS`/`INGEST_MAX`, `_tpSpawnApplied`, `_tpSettleTimer`/`_tpArrivalTimer`, `clearTpTimers`, `onTpArrivalTimeout`, `TP_SETTLE_MS`/`TP_ARRIVAL_MS` used consistently throughout. `drainWithinBudget` signature matches `budgetedDrain.js` (`{ queue, maxItems, budgetMs, processOne, onError }`).
- **Commit discipline:** no implementer commits; draft ≤50-char subjects provided for Gene.
