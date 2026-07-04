import { describe, it, expect } from 'vitest'
import { resolveRezzableAnchor } from '@/utils/rezzableAnchor'

// findItem stub over a tiny inventory: one OBJECT (assetType 6), one TEXTURE (0).
const ITEMS = {
	'obj-1': { item: { itemId: 'obj-1', name: 'Box',   assetType: 6 }, folderId: 'f1' },
	'tex-1': { item: { itemId: 'tex-1', name: 'Cloth', assetType: 0 }, folderId: 'f1' },
}
const findItem = (id) => ITEMS[id] ?? null

describe('resolveRezzableAnchor', () => {
	it('no payload → none (nothing to explain)', () => {
		expect(resolveRezzableAnchor(null, findItem)).toEqual({ reason: 'none' })
		expect(resolveRezzableAnchor(undefined, findItem)).toEqual({ reason: 'none' })
	})

	it('payload without an anchor id → none', () => {
		expect(resolveRezzableAnchor({ ids: ['obj-1'], kind: 'item', count: 1 }, findItem))
			.toEqual({ reason: 'none' })
	})

	it('single OBJECT item drag → rezzable', () => {
		expect(resolveRezzableAnchor({ id: 'obj-1', ids: ['obj-1'], kind: 'item', count: 1 }, findItem))
			.toEqual({ itemId: 'obj-1' })
	})

	it('multi-drag with an OBJECT anchor → multi (FS refuses multi-cargo world drops)', () => {
		// FS: dad3dRezObjectOnLand/OnObject return *_SINGLE acceptance; >1 cargo → TooltipMustSingleDrop
		// + drop aborted (lltooldraganddrop.cpp:2491,2560,513-521,674-681). Never "rez just the anchor".
		const p = { id: 'obj-1', ids: ['obj-1', 'tex-1', 'folder-9'], kind: 'item', count: 3 }
		expect(resolveRezzableAnchor(p, findItem)).toEqual({ reason: 'multi' })
	})

	it('multi-drag with a NON-object anchor → still multi (cargo count checked before anchor type)', () => {
		const p = { id: 'tex-1', ids: ['tex-1', 'obj-1'], kind: 'item', count: 2 }
		expect(resolveRezzableAnchor(p, findItem)).toEqual({ reason: 'multi' })
	})

	it('multi-folder drag → multi (count wins over folder reason, matching FS cursor check)', () => {
		const p = { id: 'folder-9', ids: ['folder-9', 'folder-8'], kind: 'folder', count: 2 }
		expect(resolveRezzableAnchor(p, findItem)).toEqual({ reason: 'multi' })
	})

	it('missing count falls back to ids.length for the single-drop rule', () => {
		expect(resolveRezzableAnchor({ id: 'obj-1', ids: ['obj-1', 'tex-1'], kind: 'item' }, findItem))
			.toEqual({ reason: 'multi' })
		expect(resolveRezzableAnchor({ id: 'obj-1', kind: 'item' }, findItem))
			.toEqual({ itemId: 'obj-1' })
	})

	it('folder-anchor drag → folder (rejected regardless of contents)', () => {
		expect(resolveRezzableAnchor({ id: 'folder-9', ids: ['folder-9'], kind: 'folder', count: 1 }, findItem))
			.toEqual({ reason: 'folder' })
	})

	it('unresolved anchor (stale drag / purged row) → not-object', () => {
		expect(resolveRezzableAnchor({ id: 'gone-1', ids: ['gone-1'], kind: 'item', count: 1 }, findItem))
			.toEqual({ reason: 'not-object' })
	})

	it('non-object item anchor (texture) → not-object', () => {
		expect(resolveRezzableAnchor({ id: 'tex-1', ids: ['tex-1'], kind: 'item', count: 1 }, findItem))
			.toEqual({ reason: 'not-object' })
	})
})
