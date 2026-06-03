import { describe, it, expect } from 'bun:test'
import { parseLLSD, llsdNum, llsdStr, parseLLSDBinary } from '../lib/llsd'

// ── Binary LLSD fixture builders (test-only; hand-assembled to avoid testing our own encoder) ──
const U32BE = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b }
const I32BE = (n: number) => { const b = Buffer.alloc(4); b.writeInt32BE(n); return b }
const F64BE = (n: number) => { const b = Buffer.alloc(8); b.writeDoubleBE(n); return b }
const lstr  = (marker: string, s: string) =>
	Buffer.concat([Buffer.from(marker), U32BE(Buffer.byteLength(s)), Buffer.from(s)])
const lkey  = (s: string) => lstr('k', s)
const lint  = (n: number) => Buffer.concat([Buffer.from('i'), I32BE(n)])

describe('llsd', () => {
	it('parses a cap seed map (name → url)', () => {
		const xml = `<?xml version="1.0" encoding="UTF-8"?>
<llsd><map>
  <key>FetchInventoryDescendents2</key><string>https://sim/cap/fid2</string>
  <key>GetTexture</key><string>https://sim/cap/tex</string>
</map></llsd>`
		const v = parseLLSD(xml) as Record<string, string>
		expect(v.FetchInventoryDescendents2).toBe('https://sim/cap/fid2')
		expect(v.GetTexture).toBe('https://sim/cap/tex')
	})

	it('parses nested FetchInventoryDescendents2 response with items', () => {
		const xml = `<llsd><map>
  <key>folders</key><array>
    <map>
      <key>folder_id</key><uuid>11111111-1111-1111-1111-111111111111</uuid>
      <key>version</key><integer>7</integer>
      <key>descendents</key><integer>2</integer>
      <key>items</key><array>
        <map>
          <key>item_id</key><uuid>aaaaaaaa-0000-0000-0000-000000000001</uuid>
          <key>parent_id</key><uuid>11111111-1111-1111-1111-111111111111</uuid>
          <key>name</key><string>Hello &amp; World</string>
          <key>desc</key><string>a note</string>
          <key>type</key><integer>7</integer>
          <key>inv_type</key><integer>7</integer>
          <key>asset_id</key><uuid>bbbbbbbb-0000-0000-0000-000000000002</uuid>
          <key>flags</key><integer>0</integer>
        </map>
        <map>
          <key>item_id</key><uuid>aaaaaaaa-0000-0000-0000-000000000003</uuid>
          <key>name</key><string>Script</string>
          <key>type</key><integer>10</integer>
        </map>
      </array>
      <key>categories</key><array/>
    </map>
  </array>
</map></llsd>`
		const v = parseLLSD(xml) as any
		expect(Array.isArray(v.folders)).toBe(true)
		const f = v.folders[0]
		expect(f.folder_id).toBe('11111111-1111-1111-1111-111111111111')
		expect(f.version).toBe(7)
		expect(f.items.length).toBe(2)
		expect(f.items[0].name).toBe('Hello & World')   // entity decode
		expect(f.items[0].type).toBe(7)
		expect(f.items[0].asset_id).toBe('bbbbbbbb-0000-0000-0000-000000000002')
		expect(f.items[1].name).toBe('Script')
		expect(Array.isArray(f.categories)).toBe(true)
		expect(f.categories.length).toBe(0)              // self-closed <array/>
	})

	it('handles booleans, reals, undef, empty string', () => {
		const xml = `<llsd><map>
  <key>b</key><boolean>true</boolean>
  <key>b0</key><boolean>0</boolean>
  <key>r</key><real>1.5</real>
  <key>u</key><undef/>
  <key>empty</key><string></string>
</map></llsd>`
		const v = parseLLSD(xml) as any
		expect(v.b).toBe(true)
		expect(v.b0).toBe(false)
		expect(v.r).toBe(1.5)
		expect(v.u).toBe(null)
		expect(v.empty).toBe('')
	})

	it('parses a top-level array', () => {
		const xml = `<llsd><array><string>a</string><integer>2</integer></array></llsd>`
		const v = parseLLSD(xml) as any[]
		expect(v).toEqual(['a', 2])
	})

	it('coercion helpers', () => {
		expect(llsdNum('12')).toBe(12)
		expect(llsdNum(undefined as any)).toBe(0)
		expect(llsdStr(null)).toBe('')
		expect(llsdStr(5)).toBe('5')
	})

	it('returns null on empty input', () => {
		expect(parseLLSD('')).toBe(null)
	})
})

describe('parseLLSDBinary', () => {
	it('decodes a signed integer (network byte order) and reports bytes read', () => {
		const buf = lint(42)
		const { value, end } = parseLLSDBinary(buf)
		expect(value).toBe(42)
		expect(end).toBe(5)   // 1 marker + 4 bytes
	})

	it('decodes a real (big-endian double)', () => {
		const { value } = parseLLSDBinary(Buffer.concat([Buffer.from('r'), F64BE(1.5)]))
		expect(value).toBe(1.5)
	})

	it('decodes booleans (1=true, 0=false) and undef', () => {
		expect(parseLLSDBinary(Buffer.from('1')).value).toBe(true)
		expect(parseLLSDBinary(Buffer.from('0')).value).toBe(false)
		expect(parseLLSDBinary(Buffer.from('!')).value).toBe(null)
	})

	it('decodes a length-prefixed string', () => {
		const { value } = parseLLSDBinary(lstr('s', 'hello'))
		expect(value).toBe('hello')
	})

	it('decodes a UUID into canonical hex form', () => {
		const raw = Buffer.from([
			0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88,
			0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x00,
		])
		const { value } = parseLLSDBinary(Buffer.concat([Buffer.from('u'), raw]))
		expect(value).toBe('11223344-5566-7788-99aa-bbccddeeff00')
	})

	it('decodes binary leaf to a Buffer', () => {
		const payload = Buffer.from([1, 2, 3, 4])
		const buf = Buffer.concat([Buffer.from('b'), U32BE(4), payload])
		const { value } = parseLLSDBinary(buf)
		expect(Buffer.isBuffer(value)).toBe(true)
		expect((value as Buffer).equals(payload)).toBe(true)
	})

	it('decodes an array', () => {
		const buf = Buffer.concat([
			Buffer.from('['), U32BE(2), lint(7), lstr('s', 'x'), Buffer.from(']'),
		])
		expect(parseLLSDBinary(buf).value).toEqual([7, 'x'])
	})

	it('decodes a nested map shaped like a mesh header', () => {
		const high = Buffer.concat([
			Buffer.from('{'), U32BE(2),
			lkey('offset'), lint(100),
			lkey('size'),   lint(200),
			Buffer.from('}'),
		])
		const buf = Buffer.concat([
			Buffer.from('{'), U32BE(2),
			lkey('version'),  lint(1),
			lkey('high_lod'), high,
			Buffer.from('}'),
		])
		expect(parseLLSDBinary(buf).value).toEqual({
			version: 1,
			high_lod: { offset: 100, size: 200 },
		})
	})

	it('skips the optional <? LLSD/Binary ?> header line', () => {
		const body = Buffer.concat([Buffer.from('{'), U32BE(1), lkey('v'), lint(2), Buffer.from('}')])
		const buf  = Buffer.concat([Buffer.from('<? LLSD/Binary ?>\n'), body])
		expect(parseLLSDBinary(buf).value).toEqual({ v: 2 })
	})
})
