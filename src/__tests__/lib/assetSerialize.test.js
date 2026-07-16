// src/__tests__/lib/assetSerialize.test.js
import { describe, it, expect } from 'vitest'
import {
	notecardToAsset,
	notecardFromAsset,
	scriptToAsset,
	scriptFromAsset,
	assetKindFor,
} from '@/lib/assetSerialize.js'

describe('notecardToAsset', () => {
	it('wraps text in the Linden text version 2 envelope with correct byte length', () => {
		const asset = notecardToAsset('Hello world')
		expect(asset.startsWith('Linden text version 2\n{\n')).toBe(true)
		expect(asset).toContain('Text length 11\n')
		expect(asset).toContain('Hello world}')
	})
})

describe('notecard round-trip', () => {
	const cases = [
		['empty string', ''],
		['plain text', 'Hello world'],
		['multi-line text', 'line one\nline two\nline three\n'],
		['multi-byte UTF-8 text', 'café ☃ 日本'],
	]

	for (const [label, text] of cases) {
		it(`round-trips ${label}`, () => {
			const asset = notecardToAsset(text)
			expect(notecardFromAsset(asset)).toBe(text)
		})
	}

	it('encodes the UTF-8 byte length, not the JS string length, for multi-byte text', () => {
		const text = 'café ☃ 日本'
		const asset = notecardToAsset(text)
		const byteLen = new TextEncoder().encode(text).length
		expect(byteLen).not.toBe(text.length)
		expect(asset).toContain(`Text length ${byteLen}\n`)
	})
})

describe('notecardFromAsset', () => {
	it('returns a bare string with no envelope unchanged', () => {
		const bare = 'just some plain text, no envelope at all'
		expect(notecardFromAsset(bare)).toBe(bare)
	})

	it('accepts a Linden text version 1 header', () => {
		const text = 'legacy notecard body'
		const byteLen = new TextEncoder().encode(text).length
		const asset =
			'Linden text version 1\n' +
			'{\n' +
			'LLEmbeddedItems version 1\n' +
			'{\n' +
			'count 0\n' +
			'}\n' +
			`Text length ${byteLen}\n` +
			text +
			'}\n'
		expect(notecardFromAsset(asset)).toBe(text)
	})
})

describe('scriptToAsset / scriptFromAsset', () => {
	it('are identity functions', () => {
		const script = 'default {\n\tstate_entry() {\n\t\tllSay(0, "hi");\n\t}\n}'
		expect(scriptToAsset(script)).toBe(script)
		expect(scriptFromAsset(script)).toBe(script)
	})
})

describe('assetKindFor', () => {
	it('resolves script kind (asset/inv strings differ)', () => {
		expect(assetKindFor('script')).toEqual({
			assetType: 10,
			invType: 10,
			assetTypeStr: 'lsltext',
			invTypeStr: 'script',
		})
	})

	it('resolves notecard kind', () => {
		expect(assetKindFor('notecard')).toEqual({
			assetType: 7,
			invType: 7,
			assetTypeStr: 'notecard',
			invTypeStr: 'notecard',
		})
	})
})
