// src/__tests__/lib/inventoryCache.test.js — round-trip tests for inventoryCache.js.
// Uses fake-indexeddb/auto to stub IndexedDB in the jsdom test environment.
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import {
	loadCachedInventory,
	saveCachedInventory,
	saveCachedFolders,
	clearCachedInventory,
	makeInvSavePairs,
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
