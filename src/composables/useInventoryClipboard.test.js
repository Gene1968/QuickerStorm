import { describe, it, expect } from 'vitest'
import { clipboardReducer, isClipped, useInventoryClipboard } from '@/composables/useInventoryClipboard'

const EMPTY = { mode: null, ids: [], sourceFolderId: null }

describe('clipboardReducer', () => {
	it('setCut records mode + ids (copied, not aliased)', () => {
		const ids = ['a', 'b']
		const s = clipboardReducer(EMPTY, { type: 'setCut', ids, sourceFolderId: 'F' })
		expect(s.mode).toBe('cut')
		expect(s.ids).toEqual(['a', 'b'])
		expect(s.sourceFolderId).toBe('F')
		ids.push('c')                     // mutating the input must not leak into state
		expect(s.ids).toEqual(['a', 'b'])
	})

	it('setCopy records copy mode', () => {
		const s = clipboardReducer(EMPTY, { type: 'setCopy', ids: ['x'], sourceFolderId: 'G' })
		expect(s.mode).toBe('copy')
		expect(s.ids).toEqual(['x'])
	})

	it('setCut/setCopy with no ids is a no-op (keeps prior state)', () => {
		const prev = { mode: 'copy', ids: ['x'], sourceFolderId: 'G' }
		expect(clipboardReducer(prev, { type: 'setCut', ids: [] })).toBe(prev)
		expect(clipboardReducer(prev, { type: 'setCopy', ids: undefined })).toBe(prev)
	})

	it('clear resets to empty', () => {
		const prev = { mode: 'cut', ids: ['a'], sourceFolderId: 'F' }
		expect(clipboardReducer(prev, { type: 'clear' })).toEqual(EMPTY)
	})

	it('unknown action returns state unchanged', () => {
		const prev = { mode: 'cut', ids: ['a'], sourceFolderId: 'F' }
		expect(clipboardReducer(prev, { type: 'nope' })).toBe(prev)
	})
})

describe('isClipped', () => {
	it('true only for ids on the clipboard', () => {
		const s = { mode: 'cut', ids: ['a', 'b'], sourceFolderId: null }
		expect(isClipped(s, 'a')).toBe(true)
		expect(isClipped(s, 'z')).toBe(false)
		expect(isClipped(null, 'a')).toBe(false)
	})
})

describe('useInventoryClipboard (module-level shared state)', () => {
	it('setCopy/setCut/clear drive isEmpty + mode; state is shared across calls', () => {
		const a = useInventoryClipboard()
		a.clear()
		expect(a.isEmpty.value).toBe(true)
		expect(a.mode.value).toBe(null)

		a.setCopy(['i1', 'i2'], 'src')
		// A second consumer sees the same module-level clipboard.
		const b = useInventoryClipboard()
		expect(b.isEmpty.value).toBe(false)
		expect(b.mode.value).toBe('copy')
		expect(b.clipboard.value.ids).toEqual(['i1', 'i2'])
		expect(b.isClipped('i1')).toBe(true)

		a.setCut(['f1'])
		expect(b.mode.value).toBe('cut')

		a.clear()
		expect(b.isEmpty.value).toBe(true)
	})
})
