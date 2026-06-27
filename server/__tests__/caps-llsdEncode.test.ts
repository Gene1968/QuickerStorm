// server/__tests__/caps-llsdEncode.test.ts
import { describe, it, expect } from 'bun:test'
import { encodeLLSD, llsd } from '../lib/caps/llsdEncode'
import { parseLLSD } from '../lib/llsd'

describe('encodeLLSD', () => {
	it('wraps output in an llsd envelope', () => {
		expect(encodeLLSD(null)).toBe('<?xml version="1.0" encoding="UTF-8"?>\n<llsd><undef/></llsd>')
	})

	it('round-trips plain types through parseLLSD', () => {
		const v = { a: 1, b: 'hi', c: true, d: [1, 2, 3], e: null, f: 1.5 }
		expect(parseLLSD(encodeLLSD(v))).toEqual(v)
	})

	it('defaults integer vs real by Number.isInteger', () => {
		expect(encodeLLSD(3)).toContain('<integer>3</integer>')
		expect(encodeLLSD(3.5)).toContain('<real>3.5</real>')
	})

	it('emits typed wrappers as their LLSD element', () => {
		expect(encodeLLSD(llsd.uuid('11111111-1111-1111-1111-111111111111')))
			.toContain('<uuid>11111111-1111-1111-1111-111111111111</uuid>')
		expect(encodeLLSD(llsd.real(2))).toContain('<real>2</real>')
		expect(encodeLLSD(llsd.int(2.9))).toContain('<integer>2</integer>')
		expect(encodeLLSD(llsd.binary(Buffer.from('hi')))).toContain('<binary encoding="base64">aGk=</binary>')
	})

	it('escapes entity characters in strings and keys', () => {
		expect(encodeLLSD({ 'a&b': '<x>' })).toContain('<key>a&amp;b</key><string>&lt;x&gt;</string>')
	})

	it('golden: FetchInventoryDescendents2 request body', () => {
		const body = encodeLLSD({
			folders: [{
				folder_id: llsd.uuid('22222222-2222-2222-2222-222222222222'),
				owner_id: llsd.uuid('33333333-3333-3333-3333-333333333333'),
				fetch_folders: true, fetch_items: true, sort_order: 0,
			}],
		})
		expect(body).toBe(
			'<?xml version="1.0" encoding="UTF-8"?>\n<llsd><map><key>folders</key><array><map>' +
			'<key>folder_id</key><uuid>22222222-2222-2222-2222-222222222222</uuid>' +
			'<key>owner_id</key><uuid>33333333-3333-3333-3333-333333333333</uuid>' +
			'<key>fetch_folders</key><boolean>true</boolean>' +
			'<key>fetch_items</key><boolean>true</boolean>' +
			'<key>sort_order</key><integer>0</integer>' +
			'</map></array></map></llsd>')
	})
})
