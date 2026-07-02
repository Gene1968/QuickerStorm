// src/__tests__/lib/inventoryCache.test.js — round-trip tests for inventoryCache.js.
// Uses fake-indexeddb/auto to stub IndexedDB in the jsdom test environment.
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import {
	loadCachedInventory,
	saveCachedInventory,
	saveCachedFolders,
	removeCachedFolder,
	clearCachedInventory,
	makeInvSavePairs,
	mergeItemPairs,
	foldersToPairs,
} from '@/lib/inventoryCache.js'
import { useInventoryStore } from '@/stores/inventoryStore.js'

const AGENT_A = '00000000-0000-0000-0000-000000000001'
const AGENT_B = '00000000-0000-0000-0000-000000000002'

const FOLDER_1 = 'folder-0000-0001'
const FOLDER_2 = 'folder-0000-0002'

const item = (id, name, parentId) => ({
	itemId: id, parentId, name, assetType: 0, invType: 0, assetId: 'asset-0001',
	flags: 0, createdAt: 1700000000, ownerMask: 0xE000,
})

beforeEach(async () => {
	// Isolate each test — wipe both agent entries.
	await clearCachedInventory(AGENT_A)
	await clearCachedInventory(AGENT_B)
})

describe('loadCachedInventory — empty store', () => {
	it('returns null when nothing cached for this agent', async () => {
		const result = await loadCachedInventory(AGENT_A)
		expect(result).toBeNull()
	})
})

describe('saveCachedInventory / loadCachedInventory — round-trip', () => {
	it('persists itemPairs and returns them on load', async () => {
		const pairs = [
			[FOLDER_1, [item('i1', 'Cube', FOLDER_1), item('i2', 'Ball', FOLDER_1)]],
			[FOLDER_2, [item('i3', 'Script', FOLDER_2)]],
		]
		await saveCachedInventory(AGENT_A, pairs)
		const loaded = await loadCachedInventory(AGENT_A)
		expect(loaded).not.toBeNull()
		expect(loaded.itemPairs.length).toBe(2)
		// Folder 1 items
		const f1 = loaded.itemPairs.find(([id]) => id === FOLDER_1)
		expect(f1).toBeTruthy()
		expect(f1[1].length).toBe(2)
		expect(f1[1][0].name).toBe('Cube')
		expect(f1[1][1].name).toBe('Ball')
		// Folder 2 items
		const f2 = loaded.itemPairs.find(([id]) => id === FOLDER_2)
		expect(f2[1][0].name).toBe('Script')
	})

	it('overwrites a previous snapshot with newer data', async () => {
		const first = [[FOLDER_1, [item('i1', 'Cube', FOLDER_1)]]]
		await saveCachedInventory(AGENT_A, first)
		const updated = [[FOLDER_1, [item('i1', 'Renamed Cube', FOLDER_1)]]]
		await saveCachedInventory(AGENT_A, updated)
		const loaded = await loadCachedInventory(AGENT_A)
		const f1 = loaded.itemPairs.find(([id]) => id === FOLDER_1)
		// The rename should be reflected in the persisted snapshot.
		expect(f1[1][0].name).toBe('Renamed Cube')
	})

	it('stores a savedAt timestamp', async () => {
		const before = Date.now()
		await saveCachedInventory(AGENT_A, [[FOLDER_1, []]])
		const loaded = await loadCachedInventory(AGENT_A)
		expect(loaded.savedAt).toBeGreaterThanOrEqual(before)
		expect(loaded.savedAt).toBeLessThanOrEqual(Date.now())
	})

	it('agents are isolated — loading agent B does not see agent A data', async () => {
		await saveCachedInventory(AGENT_A, [[FOLDER_1, [item('i1', 'OnlyA', FOLDER_1)]]])
		const b = await loadCachedInventory(AGENT_B)
		expect(b).toBeNull()
	})

	it('overwrites agent A without affecting agent B', async () => {
		await saveCachedInventory(AGENT_A, [[FOLDER_1, [item('i1', 'ForA', FOLDER_1)]]])
		await saveCachedInventory(AGENT_B, [[FOLDER_2, [item('i2', 'ForB', FOLDER_2)]]])
		// Overwrite A
		await saveCachedInventory(AGENT_A, [[FOLDER_1, [item('i1', 'UpdatedA', FOLDER_1)]]])
		const b = await loadCachedInventory(AGENT_B)
		const f2 = b.itemPairs.find(([id]) => id === FOLDER_2)
		// B should still have its original 'ForB' item untouched
		expect(f2[1][0].name).toBe('ForB')
	})
})

describe('clearCachedInventory', () => {
	it('removes the agent snapshot so subsequent load returns null', async () => {
		await saveCachedInventory(AGENT_A, [[FOLDER_1, [item('i1', 'Cube', FOLDER_1)]]])
		await clearCachedInventory(AGENT_A)
		const loaded = await loadCachedInventory(AGENT_A)
		expect(loaded).toBeNull()
	})

	it('no-op when nothing stored', async () => {
		// Should not throw
		await expect(clearCachedInventory(AGENT_A)).resolves.toBeUndefined()
	})
})

describe('makeInvSavePairs', () => {
	it('converts a Map<folderId, Item[]> into [[folderId, Item[]]...], skipping empty folders', () => {
		const items = new Map([
			[FOLDER_1, [item('i1', 'Cube', FOLDER_1), item('i2', 'Ball', FOLDER_1)]],
			[FOLDER_2, []],   // empty — should be excluded
		])
		const pairs = makeInvSavePairs(items)
		expect(pairs.length).toBe(1)
		expect(pairs[0][0]).toBe(FOLDER_1)
		expect(pairs[0][1].length).toBe(2)
	})

	it('returns empty array for an empty map', () => {
		expect(makeInvSavePairs(new Map())).toEqual([])
	})
})

describe('foldersToPairs', () => {
	it('keeps agent folders and drops Library (server-owned) folders', () => {
		const folders = new Map([
			[FOLDER_1, { folderId: FOLDER_1, parentId: 'root', name: 'My Stuff', source: 'agent' }],
			[FOLDER_2, { folderId: FOLDER_2, parentId: 'libroot', name: 'Library Bits', source: 'library' }],
		])
		const pairs = foldersToPairs(folders)
		expect(pairs.length).toBe(1)
		expect(pairs[0][0]).toBe(FOLDER_1)
		expect(pairs[0][1].name).toBe('My Stuff')
	})
})

// ── Write-back-lag fix (option c): a created folder must survive a hard reload that re-fetches
//    a skeleton BEFORE the grid Robust write lands, then collapse cleanly when the server confirms.
describe('created-folder write-back-lag survival', () => {
	const ROOT = 'root-0000'
	const NEW_FOLDER = 'new-folder-uuid-0001'

	beforeEach(() => setActivePinia(createPinia()))

	it('persists a created folder offline, reload loads it, then server confirm reconciles without duplicating', async () => {
		// 1) Session A: log in with a skeleton, optimistically create a folder, micro-save folders to IDB.
		const a = useInventoryStore()
		a.loadFromLogin({
			inventoryRoot: ROOT,
			inventorySkeleton: [{ folderId: ROOT, parentId: '0', name: 'My Inventory', typeDefault: 8 }],
		})
		a.addFolderOptimistic({ folderId: NEW_FOLDER, parentId: ROOT, name: 'Fresh Folder', typeDefault: -1 })
		await saveCachedFolders(AGENT_A, foldersToPairs(a.folders))

		// 2) Hard reload (Session B): the grid write-back lagged, so the fresh login skeleton does NOT
		//    include the new folder. Apply the cached folder snapshot.
		const b = useInventoryStore()
		b.loadFromLogin({
			inventoryRoot: ROOT,
			inventorySkeleton: [{ folderId: ROOT, parentId: '0', name: 'My Inventory', typeDefault: 8 }],
		})
		expect(b.folders.has(NEW_FOLDER)).toBe(false)   // skeleton alone lost it (the bug)

		const cached = await loadCachedInventory(AGENT_A)
		// Whole agent skeleton is cached (root + the new folder); the created folder must be among them.
		expect(cached.folderPairs.some(([id]) => id === NEW_FOLDER)).toBe(true)
		b.applyFolderCache(cached.folderPairs)
		// Survives the reload — re-appears from the IDB snapshot.
		expect(b.folders.has(NEW_FOLDER)).toBe(true)
		expect(b.folders.get(NEW_FOLDER).name).toBe('Fresh Folder')

		// 3) The grid write-back catches up: the server confirms the SAME folderId (the client minted
		//    the UUID). Reconcile must collapse to one row and let the server name win.
		const before = b.folders.size
		b.confirmFolder({ folderId: NEW_FOLDER, parentId: ROOT, name: 'Fresh Folder (server)', typeDefault: -1 })
		expect(b.folders.size).toBe(before)             // no duplicate row
		expect(b.folders.get(NEW_FOLDER).name).toBe('Fresh Folder (server)')   // authoritative wins
		expect(b.folders.get(NEW_FOLDER).source).toBe('agent')
	})

	it('applyFolderCache does not clobber a folder already present in the login skeleton', () => {
		const s = useInventoryStore()
		s.loadFromLogin({
			inventoryRoot: ROOT,
			inventorySkeleton: [{ folderId: FOLDER_1, parentId: ROOT, name: 'Authoritative', typeDefault: 5 }],
		})
		s.applyFolderCache([[FOLDER_1, { folderId: FOLDER_1, parentId: ROOT, name: 'Stale Cache', typeDefault: 5 }]])
		// The skeleton copy wins — cache only restores folders the skeleton lacks.
		expect(s.folders.get(FOLDER_1).name).toBe('Authoritative')
	})

	it('a moved/renamed existing folder survives reload during write-back lag', async () => {
		const P1 = 'parent-0001'
		const P2 = 'parent-0002'
		const F  = 'moved-folder-0001'

		// Session A: skeleton has folder F under parent P1 named N1. Locally move F to P2 AND rename to N2
		// → both mark F dirty. Persist the folder skeleton (write-back to the grid lags).
		const a = useInventoryStore()
		a.loadFromLogin({
			inventoryRoot: ROOT,
			inventorySkeleton: [
				{ folderId: ROOT, parentId: '0',  name: 'My Inventory', typeDefault: 8 },
				{ folderId: P1,   parentId: ROOT, name: 'P1',           typeDefault: -1 },
				{ folderId: P2,   parentId: ROOT, name: 'P2',           typeDefault: -1 },
				{ folderId: F,    parentId: P1,   name: 'N1',           typeDefault: -1 },
			],
		})
		a.moveFolderLocal(F, P2)
		a.renameFolderLocal(F, 'N2')
		expect(a.folders.get(F).dirty).toBe(true)
		await saveCachedFolders(AGENT_A, foldersToPairs(a.folders))

		// Session B reload: the grid write-back lagged, so the fresh login skeleton STILL shows F under
		// P1 named N1. applyFolderCache must apply the dirty cached copy OVER the skeleton (local edit wins).
		const b = useInventoryStore()
		b.loadFromLogin({
			inventoryRoot: ROOT,
			inventorySkeleton: [
				{ folderId: ROOT, parentId: '0',  name: 'My Inventory', typeDefault: 8 },
				{ folderId: P1,   parentId: ROOT, name: 'P1',           typeDefault: -1 },
				{ folderId: P2,   parentId: ROOT, name: 'P2',           typeDefault: -1 },
				{ folderId: F,    parentId: P1,   name: 'N1',           typeDefault: -1 },
			],
		})
		// Skeleton alone reverts F (the bug).
		expect(b.folders.get(F).parentId).toBe(P1)
		expect(b.folders.get(F).name).toBe('N1')

		const cached = await loadCachedInventory(AGENT_A)
		b.applyFolderCache(cached.folderPairs)
		// The local move + rename win over the stale skeleton, no duplicate row.
		expect(b.folders.get(F).parentId).toBe(P2)
		expect(b.folders.get(F).name).toBe('N2')
		expect(b.folders.get(F).dirty).toBe(true)   // still unconfirmed

		// A grid confirm for F clears dirty (skeleton wins on the NEXT reload).
		b.confirmFolder({ folderId: F, parentId: P2, name: 'N2', typeDefault: -1 })
		expect(b.folders.get(F).dirty).toBeUndefined()
	})

	it('saveCachedFolders preserves previously-cached itemPairs', async () => {
		await saveCachedInventory(AGENT_A, [[FOLDER_1, [item('i1', 'Cube', FOLDER_1)]]])
		await saveCachedFolders(AGENT_A, [[FOLDER_2, { folderId: FOLDER_2, parentId: 'root', name: 'New', source: 'agent' }]])
		const loaded = await loadCachedInventory(AGENT_A)
		expect(loaded.itemPairs.length).toBe(1)          // items untouched
		expect(loaded.folderPairs.length).toBe(1)        // folders added
		expect(loaded.folderPairs[0][1].name).toBe('New')
	})

	it('saveCachedInventory preserves previously-cached folderPairs', async () => {
		await saveCachedFolders(AGENT_A, [[FOLDER_2, { folderId: FOLDER_2, parentId: 'root', name: 'KeepMe', source: 'agent' }]])
		await saveCachedInventory(AGENT_A, [[FOLDER_1, [item('i1', 'Cube', FOLDER_1)]]])
		const loaded = await loadCachedInventory(AGENT_A)
		expect(loaded.folderPairs.length).toBe(1)        // folder micro-save survives the item save
		expect(loaded.folderPairs[0][1].name).toBe('KeepMe')
	})
})

// ── Item-cache never shrinks an UNFETCHED folder (FIX 2): a premature allAgentFetched save or a
//    debounced mutation-save must not persist a snapshot smaller than last-known for a folder that
//    simply hasn't been re-fetched yet. Only a folder actually fetched this session is authoritative.
describe('mergeItemPairs — item cache never shrinks an unfetched folder', () => {
	it('keeps the previously-cached list for a folder NOT fetched this session', () => {
		const prev = [[FOLDER_1, [item('i1', 'Cube', FOLDER_1)]]]
		// This session we only fetched nothing yet; next (in-memory) is transiently empty for FOLDER_1.
		const next = []
		const merged = mergeItemPairs(prev, next, () => false)   // isFetched → false for everything
		const f1 = merged.find(([id]) => id === FOLDER_1)
		expect(f1).toBeTruthy()
		expect(f1[1].length).toBe(1)   // cached item preserved (folder not re-fetched)
	})

	it('uses the current in-memory list (authoritative) for a folder that WAS fetched', () => {
		const prev = [[FOLDER_1, [item('i1', 'Cube', FOLDER_1), item('i2', 'Ball', FOLDER_1)]]]
		// FOLDER_1 fetched this session and is now genuinely down to one item (the other was purged).
		const next = [[FOLDER_1, [item('i1', 'Cube', FOLDER_1)]]]
		const merged = mergeItemPairs(prev, next, (id) => id === FOLDER_1)
		const f1 = merged.find(([id]) => id === FOLDER_1)
		expect(f1[1].length).toBe(1)   // authoritative shrink persists (genuine delete)
	})

	it('a fetched folder that is genuinely empty drops out (compact) but stays gone', () => {
		const prev = [[FOLDER_1, [item('i1', 'Cube', FOLDER_1)]]]
		const next = []   // makeInvSavePairs skips the now-empty fetched folder
		const merged = mergeItemPairs(prev, next, (id) => id === FOLDER_1)
		// FOLDER_1 was fetched + is empty → not preserved from prev (authoritative empty).
		expect(merged.some(([id]) => id === FOLDER_1)).toBe(false)
	})

	it('mixed: preserves an unfetched folder while applying a fetched folder shrink', () => {
		const prev = [
			[FOLDER_1, [item('i1', 'Cube', FOLDER_1)]],
			[FOLDER_2, [item('i2', 'Ball', FOLDER_2), item('i3', 'Script', FOLDER_2)]],
		]
		const next = [[FOLDER_2, [item('i2', 'Ball', FOLDER_2)]]]   // only FOLDER_2 re-fetched
		const merged = mergeItemPairs(prev, next, (id) => id === FOLDER_2)
		const f1 = merged.find(([id]) => id === FOLDER_1)
		const f2 = merged.find(([id]) => id === FOLDER_2)
		expect(f1[1].length).toBe(1)   // unfetched FOLDER_1 preserved
		expect(f2[1].length).toBe(1)   // fetched FOLDER_2 shrink applied
	})
})

// ── removeCachedFolder: a rejected optimistic folder-create must be DROPPED from the IDB snapshot so
//    applyFolderCache can't resurrect it on the next reload (INV_FOLDER_CREATE_FAILED path). ──
describe('removeCachedFolder — rejected folder-create is not resurrected on reload', () => {
	const ROOT = 'root-0000'
	const NEW_FOLDER = 'rejected-folder-0001'
	const KEEP_FOLDER = 'keep-folder-0001'

	beforeEach(() => setActivePinia(createPinia()))

	it('drops only the named folder, leaving itemPairs and other folders untouched', async () => {
		await saveCachedInventory(AGENT_A, [[FOLDER_1, [item('i1', 'Cube', FOLDER_1)]]])
		await saveCachedFolders(AGENT_A, [
			[NEW_FOLDER,  { folderId: NEW_FOLDER,  parentId: ROOT, name: 'Rejected', source: 'agent', dirty: true }],
			[KEEP_FOLDER, { folderId: KEEP_FOLDER, parentId: ROOT, name: 'Keep',     source: 'agent' }],
		])
		await removeCachedFolder(AGENT_A, NEW_FOLDER)
		const loaded = await loadCachedInventory(AGENT_A)
		expect(loaded.folderPairs.some(([id]) => id === NEW_FOLDER)).toBe(false)   // rejected folder dropped
		expect(loaded.folderPairs.some(([id]) => id === KEEP_FOLDER)).toBe(true)   // sibling untouched
		expect(loaded.itemPairs.length).toBe(1)                                    // items untouched
	})

	it('no-op when nothing cached (does not throw)', async () => {
		await expect(removeCachedFolder(AGENT_A, NEW_FOLDER)).resolves.toBeUndefined()
	})

	it('after remove, applyFolderCache on reload does NOT restore the rejected folder', async () => {
		// Session A: optimistically create a folder, micro-save it, then the grid rejects it → remove from cache.
		const a = useInventoryStore()
		a.loadFromLogin({
			inventoryRoot: ROOT,
			inventorySkeleton: [{ folderId: ROOT, parentId: '0', name: 'My Inventory', typeDefault: 8 }],
		})
		a.addFolderOptimistic({ folderId: NEW_FOLDER, parentId: ROOT, name: 'Rejected', typeDefault: -1 })
		await saveCachedFolders(AGENT_A, foldersToPairs(a.folders))
		// Cap rejected the create.
		a.removeFolderLocal(NEW_FOLDER)
		await removeCachedFolder(AGENT_A, NEW_FOLDER)

		// Session B reload: apply whatever the cache still holds — the rejected folder must be gone.
		const b = useInventoryStore()
		b.loadFromLogin({
			inventoryRoot: ROOT,
			inventorySkeleton: [{ folderId: ROOT, parentId: '0', name: 'My Inventory', typeDefault: 8 }],
		})
		const cached = await loadCachedInventory(AGENT_A)
		b.applyFolderCache(cached?.folderPairs || [])
		expect(b.folders.has(NEW_FOLDER)).toBe(false)   // NOT resurrected
	})
})

describe('saveCachedInventory with isFetched predicate — round-trip', () => {
	it('does not drop an unfetched folder present only in the previous snapshot', async () => {
		// Previously cached: FOLDER_1 has an item.
		await saveCachedInventory(AGENT_A, [[FOLDER_1, [item('i1', 'Cube', FOLDER_1)]]])
		// A premature save fires while FOLDER_1 has not been re-fetched (transiently empty in-memory).
		await saveCachedInventory(AGENT_A, [], (id) => id !== FOLDER_1)   // FOLDER_1 not fetched
		const loaded = await loadCachedInventory(AGENT_A)
		const f1 = loaded.itemPairs.find(([id]) => id === FOLDER_1)
		expect(f1).toBeTruthy()
		expect(f1[1].length).toBe(1)   // cached item survived the premature save
	})
})
