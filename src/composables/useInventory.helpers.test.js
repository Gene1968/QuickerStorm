// Pure helpers behind "Create folder from selected" and worn-attachment detection.
// FS references: commonParentOf ports the same-parent gate of "new_folder_from_selected"
// (phoenix-firestorm llinventoryfunctions.cpp:4032-4041, SameFolderRequired);
// parseAttachItemId ports LLViewerObject::extractAttachmentItemID's NameValue read
// (llviewerobject.cpp:7683 getNVPair("AttachItemID")).
import { describe, it, expect } from 'vitest'
import { parseAttachItemId, commonParentOf, FOLDER_TYPE_TRASH } from '@/composables/useInventory'

describe('parseAttachItemId', () => {
	// NameValue entry layout is "Name Type Class SendTo Value" (same 5-field shape
	// worldStore.parseNameValue matches for FirstName/LastName).
	const ITEM = 'c1b1cff8-1e2f-4e9a-8d2b-aaaaaaaaaaaa'

	it('extracts the item UUID from an AttachItemID entry', () => {
		expect(parseAttachItemId(`AttachItemID STRING RW SV ${ITEM}`)).toBe(ITEM)
	})

	it('finds the entry among other NameValue lines', () => {
		const nv = `FirstName STRING RW SV John\nLastName STRING RW SV Doe\nAttachItemID STRING RW SV ${ITEM}\n`
		expect(parseAttachItemId(nv)).toBe(ITEM)
	})

	it('returns "" when there is no AttachItemID entry', () => {
		expect(parseAttachItemId('FirstName STRING RW SV John')).toBe('')
		expect(parseAttachItemId('')).toBe('')
		expect(parseAttachItemId(null)).toBe('')
		expect(parseAttachItemId(undefined)).toBe('')
	})
})

describe('commonParentOf', () => {
	// Inject tiny lookups mirroring inventoryStore.folders.get / findItem shapes.
	const folders = new Map([
		['fA', { folderId: 'fA', parentId: 'root' }],
		['fB', { folderId: 'fB', parentId: 'root' }],
		['fC', { folderId: 'fC', parentId: 'fA' }],
	])
	const itemHome = { i1: 'fA', i2: 'fA', i3: 'fB' }
	const lookups = {
		getFolder: id => folders.get(id),
		findItem:  id => (itemHome[id] ? { item: { itemId: id }, folderId: itemHome[id] } : null),
	}

	it('items sharing one folder → that folder', () => {
		expect(commonParentOf(['i1', 'i2'], lookups)).toBe('fA')
	})

	it('folders sharing one parent → that parent', () => {
		expect(commonParentOf(['fA', 'fB'], lookups)).toBe('root')
	})

	it('selection spanning two folders → "" (FS SameFolderRequired)', () => {
		expect(commonParentOf(['i1', 'i3'], lookups)).toBe('')
		expect(commonParentOf(['fA', 'fC'], lookups)).toBe('')   // parents root vs fA
	})

	it('mixed kinds resolve by each row\'s own parent', () => {
		// item i1 lives in fA; folder fC's parent is fA → common parent fA
		expect(commonParentOf(['i1', 'fC'], lookups)).toBe('fA')
	})

	it('unknown id / empty selection → ""', () => {
		expect(commonParentOf(['nope'], lookups)).toBe('')
		expect(commonParentOf([], lookups)).toBe('')
		expect(commonParentOf('i1', lookups)).toBe('fA')   // single non-array id accepted
	})
})

describe('FOLDER_TYPE_TRASH', () => {
	it('is 14 (LLFolderType::FT_TRASH — matches the isInTrash guard)', () => {
		expect(FOLDER_TYPE_TRASH).toBe(14)
	})
})
