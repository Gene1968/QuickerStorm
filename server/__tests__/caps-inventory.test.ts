// server/__tests__/caps-inventory.test.ts
import { describe, it, expect } from 'bun:test'
import { buildInvRequest, decodeInvFolders } from '../lib/caps/inventoryCap'
import { encodeLLSD } from '../lib/caps/llsdEncode'
import { parseLLSD } from '../lib/llsd'

describe('inventory cap shapers', () => {
	it('builds a folders request that round-trips with the expected fields', () => {
		const req = buildInvRequest(['22222222-2222-2222-2222-222222222222'], '33333333-3333-3333-3333-333333333333')
		const back = parseLLSD(encodeLLSD(req)) as any
		expect(back.folders[0].folder_id).toBe('22222222-2222-2222-2222-222222222222')
		expect(back.folders[0].owner_id).toBe('33333333-3333-3333-3333-333333333333')
		expect(back.folders[0].fetch_folders).toBe(true)
		expect(back.folders[0].fetch_items).toBe(true)
		expect(back.folders[0].sort_order).toBe(0)
	})

	it('decodes folders → typed items with permission flags', () => {
		const xml = `<llsd><map><key>folders</key><array><map>
			<key>folder_id</key><uuid>44444444-4444-4444-4444-444444444444</uuid>
			<key>items</key><array><map>
				<key>item_id</key><uuid>55555555-5555-5555-5555-555555555555</uuid>
				<key>parent_id</key><uuid>44444444-4444-4444-4444-444444444444</uuid>
				<key>name</key><string>Hat</string>
				<key>desc</key><string>a hat</string>
				<key>type</key><integer>5</integer>
				<key>inv_type</key><integer>5</integer>
				<key>asset_id</key><uuid>66666666-6666-6666-6666-666666666666</uuid>
				<key>flags</key><integer>0</integer>
				<key>created_at</key><integer>1700000000</integer>
				<key>permissions</key><map><key>owner_mask</key><integer>${0x8000 | 0x2000}</integer></map>
			</map></array>
		</map></array></map></llsd>`
		const folders = decodeInvFolders(parseLLSD(xml))
		expect(folders).toHaveLength(1)
		expect(folders[0].folderId).toBe('44444444-4444-4444-4444-444444444444')
		const it = folders[0].items[0]
		expect(it.name).toBe('Hat')
		expect(it.assetType).toBe(5)
		expect(it.createdAt).toBe(1700000000)
		expect(it.canCopy).toBe(true)
		expect(it.canModify).toBe(false)
		expect(it.canTransfer).toBe(true)
	})
})
