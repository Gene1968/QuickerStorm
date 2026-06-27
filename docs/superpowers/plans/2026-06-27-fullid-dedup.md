# fullId Cache Dedup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the warm object cache from accumulating stale-localId duplicates of the same physical object (fullId), and remove the resulting ghost copies — fixing FEATURE-GAPS #412.

**Architecture:** `fullId` is the stable object identity (localId churns across sim restart / re-rez). Add an in-memory `fullId→localId` index to `worldStore`; reconcile by fullId at live ingest (evict the stale twin when the live copy arrives); and dedup the persistent cache by fullId at preseed (keep newest per fullId, delete stale). Entirely client-side; no IndexedDB schema bump.

**Tech Stack:** Vue 3 + Pinia (worldStore), Vite, IndexedDB (`qs-objects`). Tests: Vitest + Pinia for the store; `bun:test` + `fake-indexeddb` for the cache. Spec: `docs/superpowers/specs/2026-06-27-fullid-dedup-design.md`.

**Commits:** Per project rule ([[never-auto-commit]]), **the user commits**. Commit steps give the suggested message — stage and let Gene commit.

**Sequencing:** All client-side → no Bun restart; Vite HMR keeps the circuit. Do the tasks in order; Task 3 wires Tasks 1–2 into the engine.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/stores/worldStore.js` | Add `_byFullId` index + `localIdForFullId`; maintain in `_index`/`removeObject`/`clearAll`. |
| `src/__tests__/stores/worldStore.index.test.js` | Index maintained on upsert/remove; avatars excluded; reclaim guard. |
| `src/lib/objectCache.js` | `objCacheDedupRegion(regionKey)` — dedup by fullId, delete stale, return survivors. |
| `src/__tests__/lib/objectCache.test.js` | Dedup keeps newest per fullId, deletes stale, keeps null-fullId. |
| `src/composables/useWorldEngine.js` | preseed → `objCacheDedupRegion`; `pumpIngest` fullId reconciliation. |

---

## Task 1: worldStore fullId index

**Files:**
- Modify: `src/stores/worldStore.js` (`_prims` decl line 19; `_index` lines 22-26; `removeObject` line 76; `clearAll` line 93; return block lines 207-216)
- Test: `src/__tests__/stores/worldStore.index.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/stores/worldStore.index.test.js`:

```js
describe('fullId index', () => {
	it('localIdForFullId returns the localId of an upserted prim', () => {
		const s = useWorldStore()
		s.upsertObject({ localId: 5, fullId: 'aaa', pcode: PCODE_PRIM })
		expect(s.localIdForFullId('aaa')).toBe(5)
	})
	it('does not index avatars', () => {
		const s = useWorldStore()
		s.upsertObject({ localId: 7, fullId: 'av1', pcode: PCODE_AVATAR })
		expect(s.localIdForFullId('av1')).toBeUndefined()
	})
	it('removeObject clears the fullId entry', () => {
		const s = useWorldStore()
		s.upsertObject({ localId: 5, fullId: 'aaa', pcode: PCODE_PRIM })
		s.removeObject(5)
		expect(s.localIdForFullId('aaa')).toBeUndefined()
	})
	it('removeObject of a stale localId does not clobber a fullId reclaimed by a newer localId', () => {
		const s = useWorldStore()
		s.upsertObject({ localId: 5, fullId: 'aaa', pcode: PCODE_PRIM })
		s.upsertObject({ localId: 9, fullId: 'aaa', pcode: PCODE_PRIM })   // reclaim
		expect(s.localIdForFullId('aaa')).toBe(9)
		s.removeObject(5)                                                  // remove OLD localId
		expect(s.localIdForFullId('aaa')).toBe(9)                         // index untouched
	})
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/stores/worldStore.index.test.js`
Expected: FAIL — `s.localIdForFullId is not a function`.

- [ ] **Step 3: Add the index declaration**

In `src/stores/worldStore.js`, after the `_prims` ref (line 19), add:

```js
	// fullId → localId reverse index (prims only). localId churns across sim restart / re-rez but
	// fullId is stable; this lets ingest evict a stale-localId twin when the live copy arrives, and
	// gives applyObjectProperties an O(1) lookup. Non-reactive (no template reads it). See
	// docs/superpowers/specs/2026-06-27-fullid-dedup-design.md.
	const _byFullId = new Map()   // fullId → localId
```

- [ ] **Step 4: Index prims in `_index`**

Replace `_index` (lines 22-26):

```js
	function _index(localId, rec) {
		if (rec.pcode === PCODE_AVATAR) { _avatars.value.set(localId, rec); _prims.value.delete(localId) }
		else if (rec.pcode === PCODE_PRIM) { _prims.value.set(localId, rec); _avatars.value.delete(localId) }
		else { _avatars.value.delete(localId); _prims.value.delete(localId) }
	}
```

with:

```js
	function _index(localId, rec) {
		if (rec.pcode === PCODE_AVATAR) { _avatars.value.set(localId, rec); _prims.value.delete(localId) }
		else if (rec.pcode === PCODE_PRIM) { _prims.value.set(localId, rec); _avatars.value.delete(localId) }
		else { _avatars.value.delete(localId); _prims.value.delete(localId) }
		if (rec.pcode === PCODE_PRIM && rec.fullId) _byFullId.set(rec.fullId, localId)
	}
```

- [ ] **Step 5: Maintain the index in `removeObject`**

Replace `removeObject` (line 76):

```js
	function removeObject(localId) { objects.value.delete(localId); _unindex(localId) }
```

with:

```js
	function removeObject(localId) {
		const rec = objects.value.get(localId)
		// Only drop the fullId entry if it still points at THIS localId — a newer localId may have
		// already reclaimed the fullId (churn), and we must not clobber that.
		if (rec?.fullId && _byFullId.get(rec.fullId) === localId) _byFullId.delete(rec.fullId)
		objects.value.delete(localId); _unindex(localId)
	}
```

- [ ] **Step 6: Clear the index in `clearAll` and add the lookup + export**

Replace `clearAll` (line 93):

```js
	function clearAll() { objects.value.clear(); _avatars.value.clear(); _prims.value.clear() }
```

with:

```js
	function clearAll() { objects.value.clear(); _avatars.value.clear(); _prims.value.clear(); _byFullId.clear() }

	/** localId currently holding this fullId, or undefined. O(1) via the _byFullId index. */
	function localIdForFullId(fullId) { return _byFullId.get(fullId) }
```

Then add `localIdForFullId` to the return block (line 210), changing:

```js
		upsertObject, updateObjectPos, removeObject, applyObjectProperties, clearAll,
```

to:

```js
		upsertObject, updateObjectPos, removeObject, applyObjectProperties, clearAll, localIdForFullId,
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/__tests__/stores/worldStore.index.test.js`
Expected: PASS (existing index tests + 4 new).

- [ ] **Step 8: Commit** (stage; Gene commits)

```bash
git add src/stores/worldStore.js src/__tests__/stores/worldStore.index.test.js
git commit -m "feat(world): fullId→localId index in worldStore"
```

---

## Task 2: objCacheDedupRegion

**Files:**
- Modify: `src/lib/objectCache.js` (add `objCacheDedupRegion`; it uses existing `openDb`, `txDone`, `STORE`, `_flushing`, `_metaDirty`, `_scheduleFlush`, `objCacheGetAll`)
- Test: `src/__tests__/lib/objectCache.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/lib/objectCache.test.js` (and add `objCacheDedupRegion` to the existing import from `@/lib/objectCache.js`):

```js
describe('objCacheDedupRegion (fullId dedup)', () => {
	it('keeps newest-savedAt per fullId, deletes stale dups, keeps null-fullId', async () => {
		const rk = 'dedupRegion1'
		objCachePut(rk, { localId: 1, fullId: 'A', crc: 1 }, 100)
		objCachePut(rk, { localId: 2, fullId: 'A', crc: 2 }, 200)   // newer dup of A
		objCachePut(rk, { localId: 3, fullId: 'B', crc: 3 }, 150)
		objCachePut(rk, { localId: 4, fullId: null, crc: 4 }, 150)  // null fullId → kept
		await objCacheFlush()
		const survivors = await objCacheDedupRegion(rk)
		expect(survivors.map(d => d.localId).sort((a, b) => a - b)).toEqual([2, 3, 4])
		// IDB actually shrank (stale localId 1 deleted)
		const after = await objCacheGetAll(rk)
		expect(after.map(d => d.localId).sort((a, b) => a - b)).toEqual([2, 3, 4])
	})
	it('returns all records when there are no duplicates', async () => {
		const rk = 'dedupRegion2'
		objCachePut(rk, { localId: 1, fullId: 'X' }, 100)
		objCachePut(rk, { localId: 2, fullId: 'Y' }, 100)
		await objCacheFlush()
		const survivors = await objCacheDedupRegion(rk)
		expect(survivors.map(d => d.localId).sort((a, b) => a - b)).toEqual([1, 2])
	})
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/__tests__/lib/objectCache.test.js`
Expected: FAIL — `objCacheDedupRegion is not a function` (import undefined).

- [ ] **Step 3: Implement `objCacheDedupRegion`**

In `src/lib/objectCache.js`, add after `objCacheEvict` (the function ending near line 246):

```js
/** Collapse a region's cached records to one-per-fullId (newest savedAt wins), DELETE the stale
 * duplicates from IDB, and return the survivors' `data` (same shape as objCacheGetAll). WHY: localId
 * is not a stable object identity — it churns across sim restart / re-rez while fullId is stable, so a
 * region revisited across churn accumulates duplicate-localId records for the same object (measured:
 * 9300 records for 5332 fullIds). Records with a null fullId can't be deduped → kept as-is. Called
 * from preseed instead of objCacheGetAll. Degrades to objCacheGetAll on any error (never block paint).
 * See docs/superpowers/specs/2026-06-27-fullid-dedup-design.md. */
export async function objCacheDedupRegion(regionKey) {
	if (!regionKey) return []
	if (_flushing) { try { await _flushing } catch { /* flush failures already logged */ } }
	try {
		const db = await openDb()
		const recs = await new Promise((resolve, reject) => {
			const t = db.transaction(STORE, 'readonly')
			t.onabort = () => reject(t.error ?? new Error('dedupRegion read aborted'))
			const req = t.objectStore(STORE).index('regionKey').getAll(IDBKeyRange.only(regionKey))
			req.onsuccess = () => resolve(req.result || [])
			req.onerror   = () => reject(req.error)
		})
		const newest = new Map()   // fullId → record with max savedAt
		const stale = []           // localIds to delete
		const survivors = []
		for (const r of recs) {
			if (!r.fullId) { survivors.push(r.data); continue }   // can't dedup a null fullId
			const cur = newest.get(r.fullId)
			if (!cur) newest.set(r.fullId, r)
			else if ((r.savedAt ?? 0) > (cur.savedAt ?? 0)) { stale.push(cur.localId); newest.set(r.fullId, r) }
			else stale.push(r.localId)
		}
		for (const r of newest.values()) survivors.push(r.data)
		if (stale.length) {
			const tx = db.transaction(STORE, 'readwrite')
			const st = tx.objectStore(STORE)
			const done = txDone(tx)
			for (const lid of stale) st.delete([regionKey, lid])
			await done
			_metaDirty = true; _scheduleFlush()
			console.info(`[ObjCache] fullId-dedup ${regionKey}: ${recs.length}→${survivors.length} (deleted ${stale.length} stale-localId dups)`)
		}
		return survivors
	} catch (e) {
		console.warn('[ObjCache] dedupRegion failed, serving undeduped:', e)
		return objCacheGetAll(regionKey)
	}
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/__tests__/lib/objectCache.test.js`
Expected: PASS (existing cache tests + 2 new).

- [ ] **Step 5: Commit** (stage; Gene commits)

```bash
git add src/lib/objectCache.js src/__tests__/lib/objectCache.test.js
git commit -m "feat(objcache): objCacheDedupRegion by fullId"
```

---

## Task 3: Wire into the engine (preseed dedup + live reconciliation)

**Files:**
- Modify: `src/composables/useWorldEngine.js` — import (line 26); `_ingestQueue` area (line 326, add counter); preseed read (line 611); `pumpIngest` processOne (line 4007)

- [ ] **Step 1: Add the import**

In `src/composables/useWorldEngine.js`, change the objectCache import (line 26) from:

```js
import { objCachePut, objCacheGetAll, objCacheCrcMap, objCacheEvict, objCachePruneRegions, objCacheFlush, objCacheClearRegion } from '@/lib/objectCache.js'
```

to (add `objCacheDedupRegion`):

```js
import { objCachePut, objCacheGetAll, objCacheCrcMap, objCacheEvict, objCachePruneRegions, objCacheFlush, objCacheClearRegion, objCacheDedupRegion } from '@/lib/objectCache.js'
```

- [ ] **Step 2: Add the dedup-log counter**

After the `_ingestQueue` declaration (line 326), add:

```js
	let _fullIdDedupN = 0   // sampled log counter for live fullId-dedup evictions
```

- [ ] **Step 3: Preseed reads the deduped cache**

In `preseedRegionCache`, change (line 611):

```js
			const cached = await objCacheGetAll(key)
```

to:

```js
			const cached = await objCacheDedupRegion(key)   // collapse stale-localId dups (same fullId) + clean IDB
```

- [ ] **Step 4: Live fullId reconciliation in `pumpIngest`**

In `pumpIngest`'s `processOne` (line 4006-4007), change:

```js
			processOne: ({ o, persist }) => {
				worldStore.upsertObject(o)
```

to:

```js
			processOne: ({ o, persist }) => {
				// fullId reconciliation: a prim arriving under a NEW localId for a fullId we already hold
				// (localId churned across sim restart / re-rez) must evict the STALE twin first — scene
				// mesh, store record, and its now-dead cache entry — or the old-localId copy lingers
				// forever (the sim never KillObjects a localId it no longer uses). See
				// docs/superpowers/specs/2026-06-27-fullid-dedup-design.md.
				if (o.fullId && o.pcode !== PCODE_AVATAR) {
					const prev = worldStore.localIdForFullId(o.fullId)
					if (prev != null && prev !== o.localId) {
						pendingMeshIds.delete(prev)
						evicted.delete(prev)
						removeMesh(prev)
						worldStore.removeObject(prev)
						const dkey = regionCacheKey()
						if (dkey) objCacheEvict(dkey, prev)
						if (++_fullIdDedupN <= 10 || _fullIdDedupN % 25 === 0) {
							debugStore.push('info', `[3D] fullId-dedup: evicted stale localId ${prev} for ${String(o.fullId).slice(0, 8)} (now ${o.localId})`)
						}
					}
				}
				worldStore.upsertObject(o)
```

- [ ] **Step 5: Build to verify the client compiles**

Run: `npm run build:prod`
Expected: build succeeds (the pre-existing chunk-size warning is not an error; ESLint is broken repo-wide — build + Vitest are the gates, see [[eslint-broken-flat-config]]).

- [ ] **Step 6: Commit** (stage; Gene commits)

```bash
git add src/composables/useWorldEngine.js
git commit -m "feat(world): preseed dedup + live fullId reconciliation"
```

---

## Task 4: Live verification

- [ ] **Step 1: Hard-reload** the client (Ctrl+Shift+R) so it loads the new modules.

- [ ] **Step 2: Log into Gene's Island (Lazarus Taxon 6)** — the bloated-cache repro (9300 records / 5332 fullIds).

- [ ] **Step 3: Confirm cleanup** — the browser console shows once:

```
[ObjCache] fullId-dedup 2557696_2561280: 9300→5332 (deleted 3968 stale-localId dups)
```

and the `ClientDiag` object count settles near ~5332 (not ~9300). Reload again → dedup deletes ~0 (cache stays clean).

- [ ] **Step 4: Confirm no over-deletion** — the scene looks correct (house, objects, both avatars); nothing real is missing. Tour the region; objects that should exist are present.

- [ ] **Step 5: Confirm live reconciliation (optional)** — move/re-rez an object across a session and return; the stale copy is gone (a `[3D] fullId-dedup: evicted stale localId …` line appears), not a lingering ghost.

- [ ] **Step 6: Confirm non-churn regions unaffected** — load a normal (1:1) region; dedup deletes 0, scene unchanged.

---

## Self-Review Notes

- **Spec coverage:** Component 1 (worldStore index) → Task 1. Component 2 (ingest reconciliation) → Task 3 Steps 2,4. Component 3 (preseed dedup + cleanup) → Task 2 + Task 3 Step 3. Error handling (dedup→getAll fallback, null-fullId kept, reclaim guard) → Task 2 Step 3 + Task 1 Steps 4-5. Live verification → Task 4. All spec sections mapped.
- **No schema bump:** confirmed — `objCacheDedupRegion` uses the existing `regionKey` index and primary-key deletes; `DB_VERSION` stays 6.
- **Type/name consistency:** `localIdForFullId` (worldStore), `objCacheDedupRegion` (objectCache), `_byFullId`, `_fullIdDedupN` used identically across tasks. `PCODE_PRIM`/`PCODE_AVATAR` already in scope in both worldStore.js and useWorldEngine.js. `regionCacheKey`, `removeMesh`, `pendingMeshIds`, `evicted`, `objCacheEvict`, `debugStore` all already used in useWorldEngine.js.
- **Placeholder scan:** none.
