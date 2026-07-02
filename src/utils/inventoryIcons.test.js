import { describe, it, expect } from 'vitest'
import { itemMatchesType, itemMatchesTypeSet, TYPE_FILTERS, TYPE_FILTER_CHECKS } from './inventoryIcons'

describe('inventory type filters', () => {
	it('itemMatchesType matches on assetType', () => {
		expect(itemMatchesType({ assetType: 6 }, 'objects')).toBe(true)
		expect(itemMatchesType({ assetType: 0 }, 'objects')).toBe(false)
	})

	it('itemMatchesType treats all/falsy as match-everything', () => {
		expect(itemMatchesType({ assetType: 6 }, 'all')).toBe(true)
		expect(itemMatchesType({ assetType: 6 }, '')).toBe(true)
		expect(itemMatchesType({ assetType: 6 }, null)).toBe(true)
	})

	it('scripts filter matches both LSLText and bytecode asset types', () => {
		expect(itemMatchesType({ assetType: 10 }, 'scripts')).toBe(true)
		expect(itemMatchesType({ assetType: 11 }, 'scripts')).toBe(true)
	})

	it('snapshots filter matches on InventoryType 15 (not assetType)', () => {
		// A snapshot shares Texture assetType 0 but carries invType 15.
		expect(itemMatchesType({ assetType: 0, invType: 15 }, 'snapshots')).toBe(true)
		expect(itemMatchesType({ assetType: 0, invType: 0 }, 'snapshots')).toBe(false)
		// A plain texture must NOT match the snapshots filter…
		expect(itemMatchesType({ assetType: 0, invType: 0 }, 'textures')).toBe(true)
	})

	it('itemMatchesTypeSet matches ANY id in the set; empty set = everything', () => {
		expect(itemMatchesTypeSet({ assetType: 6 }, new Set())).toBe(true)
		expect(itemMatchesTypeSet({ assetType: 6 }, new Set(['objects']))).toBe(true)
		expect(itemMatchesTypeSet({ assetType: 6 }, new Set(['textures']))).toBe(false)
		expect(itemMatchesTypeSet({ assetType: 6 }, new Set(['textures', 'objects']))).toBe(true)
	})

	it('itemMatchesTypeSet accepts an array and treats "all" as everything', () => {
		expect(itemMatchesTypeSet({ assetType: 1 }, ['all'])).toBe(true)
		expect(itemMatchesTypeSet({ assetType: 1 }, ['sounds'])).toBe(true)
	})

	it('TYPE_FILTER_CHECKS excludes the "all" pseudo-entry', () => {
		expect(TYPE_FILTERS.some(t => t.id === 'all')).toBe(true)
		expect(TYPE_FILTER_CHECKS.some(t => t.id === 'all')).toBe(false)
	})
})
