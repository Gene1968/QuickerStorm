# Network Cache Tab — PreferencesFloater

**Date:** 2026-06-04
**Status:** Approved

## Goal

Add a "Network" tab to PreferencesFloater showing IndexedDB cache usage (entry count, size) for texture and mesh caches, with per-cache clear buttons. Helps users monitor cache fill and free space when needed.

## Scope

- Texture cache (`qs-tex`) — already has 512 MB cap + `totalBytes` in `meta` store
- Mesh cache (`qs-mesh`) — no size tracking yet; add `bytes` field on put
- Inventory cache (`qs-inv`) — excluded (JSON metadata, not binary assets)
- No sound cache exists yet; not in scope

## Data Layer Changes

### `src/lib/textureCache.js`

Add two exports:

```js
export async function getTextureCacheStats()
// Returns: { count: Number, bytes: Number, capBytes: Number }
// count  — IDBObjectStore.count() on `tex` store
// bytes  — reads totalBytes from `meta` store (key 'totalBytes')
// capBytes — TEX_CACHE_CAP_BYTES constant (512 * 1024 * 1024)

export async function clearTextureCache()
// Clears `tex` store, resets meta totalBytes to 0
```

### `src/lib/meshCache.js`

Add `bytes` field on put:

```js
// meshCachePut: calculate bytes = sum of submesh typed-array byteLength values
// Store as `bytes` field alongside `uuid` and `submeshes`
```

Add two exports:

```js
export async function getMeshCacheStats()
// Returns: { count: Number, bytes: Number }
// count — IDBObjectStore.count() on `mesh` store
// bytes — cursor sum of entry.bytes fields

export async function clearMeshCache()
// Clears `mesh` store entirely
```

## Composable: `src/composables/useCacheStats.js`

New composable. Loaded lazily when Network tab mounts.

```
State:
  texStats  = ref({ count: 0, bytes: 0, capBytes: 536870912, loading: false })
  meshStats = ref({ count: 0, bytes: 0, loading: false })

refresh()
  — parallel: getTextureCacheStats() + getMeshCacheStats()
  — sets loading: true per-cache before query, false after

clearTex()   — clearTextureCache() then refresh()
clearMesh()  — clearMeshCache() then refresh()
```

- No auto-polling. Stats are point-in-time snapshot (prefs panel, not dashboard).
- Loading flags are per-cache so each section spins independently.

## UI: Network Tab

Tab inserted in PreferencesFloater between "Sound & Media" and the first coming-soon tab.

**Layout per cache section** (qs-panel card):

```
┌─ Texture Cache ──────────────────────────────────┐
│  Entries: 1,247          Size: 312.4 MB / 512 MB  │
│  [████████████░░░░░░] 61%                         │
│                                [Clear Textures]   │
└──────────────────────────────────────────────────┘

┌─ Mesh Cache ─────────────────────────────────────┐
│  Entries: 89             Size: 44.1 MB            │
│                                [Clear Meshes]     │
└──────────────────────────────────────────────────┘
```

- Progress bar: texture only (has cap). Mesh section: no bar, no cap label.
- Bytes formatted via `formatBytes(n)` helper — add to `src/utils/formatBytes.js` (does not exist yet). Returns `"44.1 MB"`, `"1.2 GB"`, etc.
- While loading: spinner replaces numeric values.
- After clear: stats re-query immediately → values reset to 0.
- Styling: `qs-panel` card per section, Tailwind tokens (`text-t1`, `bg-card`, `text-accent`, `qs-btn`).

## Implementation Order

1. `src/utils/formatBytes.js` — new helper
2. `meshCache.js` — add `bytes` field on put
3. `textureCache.js` — add `getTextureCacheStats` + `clearTextureCache`
4. `meshCache.js` — add `getMeshCacheStats` + `clearMeshCache`
5. `useCacheStats.js` — composable
6. `PreferencesFloater.vue` — Network tab + UI

## Out of Scope

- Configurable cache size limits (read-only cap display only)
- Sound cache (doesn't exist yet)
- Auto-refresh / live monitoring
- Cache location on disk / browser storage inspector link
