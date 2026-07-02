import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useInventoryStore } from '@/stores/inventoryStore'

beforeEach(() => setActivePinia(createPinia()))

// Pressing Del on a row already in Trash must be a no-op (FS greys out Delete there); isInTrash is
// the store predicate the trash call sites use to skip a redundant "move to Trash".
const ROOT = 'root-0000'

function login() {
	const store = useInventoryStore()
	store.loadFromLogin({
		inventoryRoot: ROOT,
		inventorySkeleton: [
			{ folderId: ROOT,    parentId: '0',  name: 'My Inventory', typeDefault: 8 },
			{ folderId: 'trash', parentId: ROOT, name: 'Trash',        typeDefault: 14 },
			{ folderId: 'objs',  parentId: ROOT, name: 'Objects',      typeDefault: 6 },
			{ folderId: 'user',  parentId: ROOT, name: 'MyFolder',     typeDefault: -1 },
			// A user folder that itself sits inside Trash (dragged there earlier).
			{ folderId: 'sub',   parentId: 'trash', name: 'Sub',       typeDefault: -1 },
		],
	})
	return store
}

const item = (id, parentId) => ({ itemId: id, parentId, name: id, assetType: 0, invType: 0 })

describe('inventoryStore.isInTrash', () => {
	it('returns false for the empty/unknown id', () => {
		const s = login()
		expect(s.isInTrash('')).toBe(false)
		expect(s.isInTrash('nope')).toBe(false)
	})

	it('folder NOT in Trash → false; folder living inside Trash → true', () => {
		const s = login()
		expect(s.isInTrash('user')).toBe(false)
		expect(s.isInTrash('objs')).toBe(false)
		expect(s.isInTrash('sub')).toBe(true)           // parent chain hits Trash
	})

	it('the Trash folder itself counts as in-Trash (deleting Trash is a no-op)', () => {
		const s = login()
		expect(s.isInTrash('trash')).toBe(true)
	})

	it('item in a normal folder → false; item inside Trash (or a subfolder of it) → true', () => {
		const s = login()
		s.setItems('objs',  [item('keep', 'objs')])
		s.setItems('trash', [item('gone', 'trash')])
		s.setItems('sub',   [item('deep', 'sub')])
		expect(s.isInTrash('keep')).toBe(false)
		expect(s.isInTrash('gone')).toBe(true)
		expect(s.isInTrash('deep')).toBe(true)
	})
})
