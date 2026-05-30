import { describe, it, expect } from 'bun:test'
import { parseLLSD, llsdNum, llsdStr } from '../lib/llsd'

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
