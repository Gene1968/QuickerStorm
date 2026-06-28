// src/__tests__/lib/inventoryCache.test.js — round-trip tests for inventoryCache.js.
// Uses fake-indexeddb/auto to stub IndexedDB in the jsdom test environment.
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import {
	loadCachedInventory,
	saveCachedInventory,
	clearCachedInventory,
	makeInvSavePairs,
} from '@/lib/inventoryCache.js'

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
