import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useInventoryStore } from '@/stores/inventoryStore'

beforeEach(() => setActivePinia(createPinia()))

// HG sessions (and OpenSim's GetRootFolder) create a full system-folder set under the
// "My Suitcase" folder (type 100), so TWO folders match typeDefault 23: the real /Favorites
// (a direct child of the agent root) and /My Suitcase/Favorites. findSystemFolder must return
// the top-level one regardless of skeleton order.
function loginWithSuitcaseFavorites({ suitcaseFirst }) {
	const store = useInventoryStore()
	const root = 'root-0000'
	const realFav = { folderId: 'fav-real', parentId: root, name: 'Favorites', typeDefault: 23 }
	const suitcase = { folderId: 'suitcase-0', parentId: root, name: 'My Suitcase', typeDefault: 100 }
	const suitcaseFav = { folderId: 'fav-suitcase', parentId: 'suitcase-0', name: 'Favorites', typeDefault: 23 }
	const myInv = { folderId: root, parentId: '00000000-0000-0000-0000-000000000000', name: 'My Inventory', typeDefault: 8 }
	// Order matters: a Map keeps insertion order, so list the suitcase Favorites first to prove
	// the fix doesn't depend on skeleton ordering.
	const skeleton = suitcaseFirst
		? [myInv, suitcase, suitcaseFav, realFav]
		: [myInv, suitcase, realFav, suitcaseFav]
	store.loadFromLogin({ inventoryRoot: root, inventorySkeleton: skeleton })
	return store
}

describe('inventoryStore.findSystemFolder — suitcase disambiguation', () => {
	it('returns the top-level Favorites even when the suitcase copy is listed first', () => {
		const store = loginWithSuitcaseFavorites({ suitcaseFirst: true })
		expect(store.findSystemFolder(23)).toBe('fav-real')
	})

	it('returns the top-level Favorites when it is listed first too', () => {
		const store = loginWithSuitcaseFavorites({ suitcaseFirst: false })
		expect(store.findSystemFolder(23)).toBe('fav-real')
	})

	it('falls back to any match when no copy is a direct child of root (HG suitcase-only skeleton)', () => {
		const store = useInventoryStore()
		// HG-outbound login: inventory-root IS the suitcase; Favorites sits under it.
		store.loadFromLogin({
			inventoryRoot: 'suitcase-0',
			inventorySkeleton: [
				{ folderId: 'suitcase-0', parentId: '0', name: 'My Suitcase', typeDefault: 100 },
				{ folderId: 'fav-suitcase', parentId: 'suitcase-0', name: 'Favorites', typeDefault: 23 },
			],
		})
		expect(store.findSystemFolder(23)).toBe('fav-suitcase')
	})
})
