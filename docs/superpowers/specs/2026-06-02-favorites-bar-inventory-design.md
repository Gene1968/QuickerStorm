# Favorites Bar + PlacesFloater — Inventory-Backed Favorites

**Date:** 2026-06-02
**Status:** Approved

## Problem

FavoritesBar and the PlacesFloater Favorites tab currently show a localStorage quick-save list (`qs_places_<agentId>`). This predates inventory implementation. The Inventory/Favorites folder (typeDefault=23) is now populated and IndexedDB-cached, making it the correct source of truth — matching Firestorm's behavior where the Favorites Bar and Places › Favorites both reflect the same inventory folder.

## Goal

- FavoritesBar shows landmarks from the Inventory/Favorites folder.
- PlacesFloater Favorites tab shows landmarks from the same folder.
- localStorage favorites are removed entirely.
- "Save here" form removed; landmark creation goes through the Plus icon → `CreateLandmarkFloater` (same as the LocationBar star), with Favorites folder pre-selected.
- Rename / delete deferred (no server cap yet); interaction parity with the Landmarks tab for now.

## Data Source

`inventoryStore.items` is a `Map<folderId, Item[]>` pre-populated from IndexedDB on every login after the first. `findSystemFolder(23)` returns the Favorites folder ID. Filtering `items.get(favId)` for `assetType === 3` (AT_LANDMARK) gives the set to display. No eager-fetch step required — IndexedDB provides immediate availability; the background cap-fetch updates stale data as it runs.

New landmarks created via `createLandmark` are inserted immediately into the store on `S.INV_ITEM_CREATED` (`addCreatedItems`), which the existing `allAgentFetched` watcher then persists back to IndexedDB.

## Changes

### `src/composables/usePlaces.js`

**Remove:**
- `favorites` ref, `FAV_KEY`, `loadFor`, `persistFor`
- `addFavorite`, `removeFavorite`, `renameFavorite` functions and their return exports
- The `loadFor` call at the top of `usePlaces()`

**Add:**
```js
const invFavorites = computed(() => {
    const favId = inventory.findSystemFolder(23)
    if (!favId) return []
    return (inventory.items.get(favId) || [])
        .filter(it => it.assetType === AT_LANDMARK && it.assetId)
        .map(it => ({ name: it.name || '(landmark)', landmarkId: it.assetId, itemId: it.itemId }))
        .sort((a, b) => a.name.localeCompare(b.name))
})
```

**Return:** `invFavorites` in place of `favorites`.

### `src/components/FavoritesBar.vue`

- Import `invFavorites` and `teleportToLandmark` from `usePlaces()`.
- Replace `v-if="favorites.length"` → `v-if="invFavorites.length"`.
- Replace `v-for` over `favorites` → `invFavorites`.
- Call `teleportToLandmark(p)` on click (these are inventory landmarks, not `{x,y,z}` places).
- Tooltip: show just the landmark name (no coordinates — landmark assets don't carry client-side `x/y/z`).

### `src/components/PlacesFloater.vue`

**Favorites tab:**
- Consume `invFavorites` from `usePlaces()`.
- Replace the localStorage list with the same row pattern as "My landmarks" in the Landmarks tab: 📌 icon, name, TP button on hover via `teleportToLandmark`.
- Remove inline rename `<input>` and trash button (deferred — same as Landmarks tab).
- Remove the "Save here" `<form>` at the bottom of the Favorites tab.
- Empty-state: `'No favorites yet — use the ✦ star or ＋ button to add one.'`

**Plus icon button:**
- The Plus icon is shared across Favorites and Landmarks tabs (`v-if="placesActiveTab !== 'history'"`). The click handler becomes tab-aware:
  - Favorites tab → `ui.openCreateLandmark({ folderId: inv.findSystemFolder(23) })` (pre-selects Favorites folder)
  - Landmarks tab → `ui.openCreateLandmark()` (no hint → `CreateLandmarkFloater` defaults to Landmarks root as before)
- `createLandmarkPrefill` gains an optional `folderId` field: `{ name?, folderId? }`.
- `CreateLandmarkFloater` initializes `selectedFolder` from `ui.createLandmarkPrefill?.folderId || ''` so the watcher guard preserves it if valid, otherwise falls back to the Landmarks root.

**Script cleanup:**
- Remove `addFavorite`, `removeFavorite`, `renameFavorite`, `saveCurrent`, `newName` from the script.
- Remove `filteredFavorites` computed; replace with `filteredInvFavorites` filtering `invFavorites`.

### `src/stores/uiStore.js` (no change needed)

`openCreateLandmark(prefill)` already accepts an arbitrary prefill object and stores it in `createLandmarkPrefill`. No store change required — callers just pass `{ folderId }` in the prefill.

### `src/components/CreateLandmarkFloater.vue` (minor)

Change the `selectedFolder` initializer from `ref('')` to `ref(ui.createLandmarkPrefill?.folderId || '')`. The existing watcher guard already preserves a pre-set value if it matches a valid folder option.

## Out of Scope

- Rename / F2 and delete / Del for inventory items — deferred until the rename/delete cap layer is implemented.
- Non-landmark items in the Favorites folder (notecards, objects, etc.) — only `assetType === 3` items appear in the bar and tab.
- Migration of existing localStorage favorites — no migration; localStorage entries are abandoned in place (they'll expire naturally or users can clear manually).
