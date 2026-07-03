// Empty Trash — the store's AUTHORIZED SHRINK. Mirrors FS purge_descendents_of
// (phoenix-firestorm llviewerinventory.cpp:1898; OpenSim path :1955-1965 sends
// PurgeInventoryDescendents and updates the model immediately — no reply message).
// The critical property under test: the non-shrinking cache machinery (mergeItemPairs keeps a
// NOT-fetched folder's previously-cached list; saveCachedFolders unions folders) exists to stop
// accidental data loss — a purge is an AUTHORIZED shrink, so purged rows must (a) vanish locally,
// (b) NOT resurrect through a cache save/load round-trip, and (c) NOT resurrect through the
// move-reconciliation state machine (a pending move pinned INTO the purged subtree).
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useInventoryStore } from '@/stores/inventoryStore'
import { mergeItemPairs, makeInvSavePairs } from '@/lib/inventoryCache'

const ROOT = 'root-0000'

function login(store) {
	store.loadFromLogin({
		inventoryRoot: ROOT,
		inventorySkeleton: [
			{ folderId: ROOT,    parentId: '0',     name: 'My Inventory', typeDefault: 8 },
			{ folderId: 'objs',  parentId: ROOT,    name: 'Objects',      typeDefault: 6 },
			{ folderId: 'trash', parentId: ROOT,    name: 'Trash',        typeDefault: 14 },
		],
	})
}

const item = (id, parentId) => ({ itemId: id, parentId, name: id, assetType: 6, invType: 6, ownerMask: 0xE000 })

// Seed: Trash holds one direct item + a subfolder tree (sub → subsub) with an item in each;
// Objects holds a keeper item that must survive the purge untouched.
function seed() {
	const s = useInventoryStore()
	login(s)
	// user subfolders living inside Trash (dragged there earlier)
	s.addFolderOptimistic({ folderId: 'sub',    parentId: 'trash', name: 'Sub' })
	s.addFolderOptimistic({ folderId: 'subsub', parentId: 'sub',   name: 'SubSub' })
	s.setItems('objs',   [item('keep-1', 'objs')])
	s.setItems('trash',  [item('dead-1', 'trash')])
	s.setItems('sub',    [item('dead-2', 'sub')])
	s.setItems('subsub', [item('dead-3', 'subsub')])
	return s
}

beforeEach(() => setActivePinia(createPinia()))

describe('inventoryStore.purgeDescendantsLocal', () => {
	it('removes ALL descendants — items, subfolders, sub-subfolders — and keeps the Trash folder itself', () => {
		const s = seed()
		const out = s.purgeDescendantsLocal('trash')

		expect(s.folderItems('trash')).toEqual([])            // direct items gone
		expect(s.folders.has('trash')).toBe(true)             // Trash itself survives (Empty, not Delete)
		expect(s.folders.has('sub')).toBe(false)              // descendant folders gone
		expect(s.folders.has('subsub')).toBe(false)
		expect(s.folderItems('sub')).toEqual([])              // their item lists dropped
		expect(s.folderItems('subsub')).toEqual([])
		// untouched elsewhere
		expect(s.folderItems('objs').map(i => i.itemId)).toEqual(['keep-1'])
		// reports what it purged so the caller can evict the folders from the IDB folder cache
		expect(out.folderIds.sort()).toEqual(['sub', 'subsub'])
		expect(out.itemIds.sort()).toEqual(['dead-1', 'dead-2', 'dead-3'])
	})

	it('marks the purged folders FETCHED (the flag that authorizes the cache shrink)', () => {
		const s = seed()
		s.purgeDescendantsLocal('trash')
		expect(s.isFetched('trash')).toBe(true)
		expect(s.isFetched('sub')).toBe(true)
		expect(s.isFetched('subsub')).toBe(true)
	})

	it('is a no-op for an unknown folder', () => {
		const s = seed()
		const out = s.purgeDescendantsLocal('nope')
		expect(out).toEqual({ itemIds: [], folderIds: [] })
		expect(s.folderItems('trash').length).toBe(1)
	})

	it('cache save/load round-trip does NOT resurrect purged rows', () => {
		const s = seed()
		// Snapshot the pre-purge cache state (what IDB would hold from an earlier save).
		const prevPairs = makeInvSavePairs(s.items).map(([fid, list]) => [fid, list.map(i => ({ ...i }))])
		expect(prevPairs.map(p => p[0]).sort()).toEqual(['objs', 'sub', 'subsub', 'trash'])

		s.purgeDescendantsLocal('trash')

		// SAVE: the exact merge the mutation-save runs (saveCachedInventory → mergeItemPairs with
		// the store's isFetched predicate). Purged folders are marked fetched → their now-empty
		// lists are authoritative → the previously-cached rows are dropped, not resurrected.
		const nextPairs = makeInvSavePairs(s.items)
		const merged = mergeItemPairs(prevPairs, nextPairs, id => s.isFetched(id))
		const mergedIds = merged.map(p => p[0])
		expect(mergedIds).toEqual(['objs'])                   // only the keeper folder persists

		// LOAD: hydrate a fresh session from the merged snapshot — nothing purged comes back.
		setActivePinia(createPinia())
		const s2 = useInventoryStore()
		login(s2)
		s2.applyCachedItems(merged)
		expect(s2.folderItems('trash')).toEqual([])
		expect(s2.folderItems('sub')).toEqual([])
		expect(s2.folderItems('subsub')).toEqual([])
		expect(s2.folderItems('objs').map(i => i.itemId)).toEqual(['keep-1'])
	})

	it('contrast: WITHOUT the purge, the non-shrinking merge keeps an unfetched folder\'s rows', () => {
		// Sanity check that the round-trip test above is actually exercising the shrink guard:
		// a folder NOT fetched this session keeps its previously-cached list.
		const s = seed()
		const prevPairs = makeInvSavePairs(s.items)
		const merged = mergeItemPairs(prevPairs, [], () => false)   // nothing fetched, empty session
		expect(merged.map(p => p[0]).sort()).toEqual(['objs', 'sub', 'subsub', 'trash'])
	})

	it('retires pending-move records so a lagging fetch cannot resurrect a purged item', () => {
		const s = seed()
		// Optimistically move keep-1 into the Trash (pendingMoves record: toFolderId = trash) …
		s.moveItemLocal('keep-1', 'trash')
		expect(s.folderItems('trash').some(i => i.itemId === 'keep-1')).toBe(true)
		// … then Empty Trash before the grid confirms.
		s.purgeDescendantsLocal('trash')
		expect(s.folderItems('trash')).toEqual([])
		// An authoritative (empty) fetch of the Trash must NOT re-pin the purged item back in —
		// _reconcilePending re-adds rows whose pending record targets the folder; the purge must
		// have retired that record.
		s.setItems('trash', [])
		expect(s.folderItems('trash')).toEqual([])
		// And a lagging SRC fetch that still lists it stores it plainly (grid will reconcile) —
		// but no pendingMove stamp survives to pin it anywhere.
		s.setItems('objs', [item('keep-1', 'objs')])
		expect(s.folderItems('objs').find(i => i.itemId === 'keep-1')?.pendingMove).toBeUndefined()
	})
})

describe('inventoryStore worn-attachment tracking', () => {
	it('markWorn / markDetached toggle membership; loadFromLogin resets', () => {
		const s = seed()
		s.markWorn('item-x')
		expect(s.wornAttachments.has('item-x')).toBe(true)
		s.markDetached('item-x')
		expect(s.wornAttachments.has('item-x')).toBe(false)
		s.markWorn('item-y')
		login(s)                                              // re-login → session state resets
		expect(s.wornAttachments.size).toBe(0)
	})

	it('markDetached of an untracked id is a no-op', () => {
		const s = seed()
		expect(() => s.markDetached('never-worn')).not.toThrow()
		expect(s.wornAttachments.size).toBe(0)
	})
})
