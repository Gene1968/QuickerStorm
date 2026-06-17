# Defer the inventory bulk-walk until the region is idle

> Design spec, 2026-06-17. Fixes the ~5-minute (really ~7-min) cold-load asset stall root-caused via
> systematic-debugging: the greedy full-inventory prefetch at login saturates the client main thread
> (~2 fps) and starves region texture/mesh loading. Read FEATURE-GAPS "Cold-asset-pipeline work" #2.

## Root cause (confirmed, live evidence)

On a cold region load, `useInventory.fetchAll()` (a background bulk loader that walks the **entire**
agent inventory tree — `MAX_INFLIGHT=80` folders in flight, `BATCH=40`/POST, `PUMP_MS=150`, purely
"so the grand total becomes exact, FS-style") fires immediately at caps-ready (`onCapsReady`, line
108). Each `INV_FOLDER` response (folders of up to **3404 items**) is processed synchronously on the
client main thread via `inv.setItems()`.

Live telemetry (Requiem cold load): inventory fetches run continuously **13:27:46 → 13:35:12**; during
that window the client `[Main]` shows **`frames=17` (~2 fps), `longtasks=32 total=3854ms`** of
main-thread blocking *not* attributed to render/ws-parse (= inventory processing). Texture/mesh
throughput is ~12/min + ~3/min during the stall, with the server's decode pool **idle** and individual
fetches **fast (<1s)** — so it is **contention**, not a fetch-throughput limit. At **13:35:28** (right
after inventory finishes) `longtasks → 0`, `frames → 118`, and asset throughput jumps ~25×.

**The world (textures/meshes the user is staring at) starves for ~7 min so the client can prefetch
inventory totals the user did not ask to see.** Inventory totals are not urgent; the region is.

## Approach — gate the bulk-walk on region-idle

Don't start the inventory bulk walk until the region's assets have drained (the scene is "idle"),
bounded by a safety ceiling so a pathological never-settling region can't starve inventory forever.
The engine already computes the needed "loading" signal; we just publish it and have the inventory
pump consult it.

### 1. `src/stores/worldStore.js` — publish the load-state flag

Add a `sceneLoading` ref (default `true`) and a `setSceneLoading(v)` action, exported from the store.
Default `true` so the gate holds until the engine reports the first settle (safe: before any cull tick
runs we assume "loading").

```js
const sceneLoading = ref(true)
function setSceneLoading(v) { sceneLoading.value = !!v }
// ...add `sceneLoading, setSceneLoading` to the store's return object.
```

### 2. `src/composables/useWorldEngine.js` — publish the existing signal

In `cullTick`, where `loading` is already computed and fed to `setGeomCacheLoading(loading)` /
`setTexCacheLoading(loading)` (~line 3435–3438), add one line:

```js
worldStore.setSceneLoading(loading)
```

No new logic. `loading = pendingMeshIds.size > 50 || tStat.queued > 0 || tStat.inflight > 0 ||
mStat.queued > 0 || _geomPending > 25` — true while the region's geometry/textures/meshes are still
draining, false once settled. (`worldStore` is already imported in the engine.)

### 3. `src/composables/useInventory.js` — self-gate the `fetchAll` pump

Import the world store and record a caps-ready timestamp. The pump (started at caps-ready, unchanged)
gains one gate at the top of each tick:

```js
const FETCHALL_DEFER_CEILING_MS = 240_000   // safety net: start the walk anyway after this even if
                                            // the region never reports idle (pathological/stuck load)
let capsReadyAt = 0

// in fetchAll():
pump = setInterval(() => {
	if (!inv.capsReady) return
	// Defer the full inventory walk until the region's assets have drained, so it doesn't peg the
	// main thread and starve region texture/mesh loading (cold-load contention). Bounded by a ceiling
	// so a never-settling region still loads inventory eventually.
	if (world.sceneLoading && performance.now() - capsReadyAt < FETCHALL_DEFER_CEILING_MS) return
	const slots = MAX_INFLIGHT - inv.fetching.size
	const pending = inv.pendingAgentFolders()
	if (pending.length === 0 && inv.fetching.size === 0) { stopFetchAll(); return }
	if (slots > 0 && pending.length > 0) fetchFolders(pending.slice(0, slots))
}, PUMP_MS)
```

Set `capsReadyAt = performance.now()` in `onCapsReady` (before/at the `fetchAll()` call).

**Unchanged + still immediate** (user-initiated, tiny, must stay responsive):
- `fetchFolder` / `fetchFolders` on folder expand.
- The expanded-folder backfill loop in `onCapsReady` (line 106: `for (const id of inv.expanded) …`).

Only the **background full walk** is gated.

## Behavior

- **Normal region:** pump spins (no-op) while `sceneLoading` is true; once the region's assets drain
  (`loading → false`), the walk begins — after the world is usable, not competing with it. Expected
  cold load drops from ~13 min toward ~4 min (textures then run at the server-bound rate with a free
  main thread); inventory totals fill in afterward.
- **Subsequent loads / TP:** the pump is created once and runs for the session; the ceiling is measured
  from caps-ready, so the gate primarily protects the *initial* cold load. (Pausing the walk on every
  later region entry is a possible future refinement, out of scope here.)
- **Pathological never-idle region:** after `FETCHALL_DEFER_CEILING_MS` (240 s) the walk proceeds
  regardless, so inventory is never permanently starved.

## Testing — `useInventory` (Vitest/bun test)

The existing inventory test setup drives `onCapsReady` / the pump. Add cases (inject a fake world
store flag + a controllable clock for `performance.now`, or drive via the store):

1. **gated while loading:** with `sceneLoading = true` and `< ceiling` elapsed, advancing the pump does
   NOT emit `INV_FETCH_FOLDER` for the bulk walk (no `fetchFolders` of pending agent folders).
2. **starts on idle:** flip `sceneLoading = false` → next pump tick emits the bulk-walk fetch.
3. **ceiling fallback:** keep `sceneLoading = true` but advance the clock past
   `FETCHALL_DEFER_CEILING_MS` → the walk proceeds.
4. **on-expand stays immediate:** `fetchFolder(id)` emits `INV_FETCH_FOLDER` regardless of
   `sceneLoading` (not gated).

If `useInventory` has no existing unit test harness, add a focused one mocking `useRealtimeSocket`
(capture `emit`), `useInventoryStore`, and the world store flag.

## File structure

| File | Responsibility | Change |
|---|---|---|
| `src/stores/worldStore.js` | publish `sceneLoading` flag | MODIFY (small) |
| `src/composables/useWorldEngine.js` | set `sceneLoading` from existing `loading` in `cullTick` | MODIFY (1 line) |
| `src/composables/useInventory.js` | gate the `fetchAll` pump on `sceneLoading` (bounded) | MODIFY |
| `src/__tests__/...useInventory*` | gate behavior tests | CREATE or MODIFY |

## Out of scope

- Chunking `inv.setItems` across frames (option B) — not needed once the walk is out of the cold-load
  window; revisit only if warm-revisit hitching from a big folder shows up.
- Lazy inventory / dropping the bulk-walk (option C) — keeps the exact-total feature, just defers it.
- Pausing the walk on every subsequent region entry (TP) — primary fix targets the initial cold load.

## Acceptance

- Vitest/bun test green (new gate tests + no regressions).
- `npm run build:prod` green.
- Live: cold-load a region — `[Main]` no longer shows the multi-second `longtasks` block during the
  first minutes; inventory `[Inv]` fetches do NOT begin until the region's assets drain (or 240 s);
  texture/mesh throughput is steady from the start instead of stalling ~5–7 min; cold load is
  materially faster. Inventory totals still reach the exact count, just later.
- Gene commits.
