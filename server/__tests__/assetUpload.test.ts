import { describe, it, expect } from 'bun:test'
import { updateItemAsset, uploadNewAsset } from '../lib/caps/assetUpload'
import { parseLLSD, llsdStr } from '../lib/llsd'

// A scripted fetch: each call returns the next canned LLSD response and records what was posted.
function mockFetch(responses: string[]) {
	const calls: { url: string; body: any; headers: any }[] = []
	const fn = (async (url: any, init: any) => {
		calls.push({ url: String(url), body: init?.body, headers: init?.headers })
		const text = responses[calls.length - 1] ?? '<llsd><undef/></llsd>'
		return { status: 200, text: async () => text } as any
	}) as unknown as typeof fetch
	return { fn, calls }
}

const llsdMap = (m: Record<string, string>) =>
	`<llsd><map>${Object.entries(m).map(([k, v]) => `<key>${k}</key><string>${v}</string>`).join('')}</map></llsd>`

const STEP1_OK = llsdMap({ state: 'upload', uploader: 'http://sim/CAPS/upl-123' })
const STEP2_OK = llsdMap({ state: 'complete', new_asset: 'aaaaaaaa-0000-0000-0000-000000000001', new_inventory_item: 'bbbbbbbb-0000-0000-0000-000000000002' })

describe('updateItemAsset (save into existing item)', () => {
	it('runs the 2-step handshake and returns the new asset/item ids', async () => {
		const { fn, calls } = mockFetch([STEP1_OK, STEP2_OK])
		const bytes = Buffer.from('Linden text version 2\n{\n...\n}', 'utf8')
		const res = await updateItemAsset('http://sim/cap/UpdateNotecard', { itemId: 'cccccccc-0000-0000-0000-000000000003' }, bytes, fn)

		expect(res.ok).toBe(true)
		expect(res.assetId).toBe('aaaaaaaa-0000-0000-0000-000000000001')
		expect(res.itemId).toBe('bbbbbbbb-0000-0000-0000-000000000002')

		// step 1: LLSD body carries item_id + a zero task_id
		expect(calls.length).toBe(2)
		const step1 = parseLLSD(calls[0].body) as any
		expect(llsdStr(step1.item_id)).toBe('cccccccc-0000-0000-0000-000000000003')
		expect(llsdStr(step1.task_id)).toBe('00000000-0000-0000-0000-000000000000')
		// step 2: the EXACT bytes are posted to the uploader url returned by step 1
		expect(calls[1].url).toBe('http://sim/CAPS/upl-123')
		expect(Buffer.isBuffer(calls[1].body)).toBe(true)
		expect((calls[1].body as Buffer).equals(bytes)).toBe(true)
	})

	it('surfaces a step-1 rejection (state != upload) without posting bytes', async () => {
		const err = llsdMap({ state: 'error' }).replace('</map>', '<key>error</key><map><key>message</key><string>no perms</string></map></map>')
		const { fn, calls } = mockFetch([err])
		const res = await updateItemAsset('http://sim/cap', { itemId: 'x' }, Buffer.from('x'), fn)
		expect(res.ok).toBe(false)
		expect(res.error).toBe('no perms')
		expect(calls.length).toBe(1)   // never reached step 2
	})

	it('fails when step-2 does not complete', async () => {
		const badStep2 = llsdMap({ state: 'failed' })
		const { fn } = mockFetch([STEP1_OK, badStep2])
		const res = await updateItemAsset('http://sim/cap', { itemId: 'x' }, Buffer.from('x'), fn)
		expect(res.ok).toBe(false)
		expect(res.error).toContain('failed')
	})
})

describe('uploadNewAsset (fresh asset + item)', () => {
	it('sends asset_type/inventory_type/folder_id in step 1 and returns ids', async () => {
		const { fn, calls } = mockFetch([STEP1_OK, STEP2_OK])
		const res = await uploadNewAsset('http://sim/cap/NewFile', {
			assetTypeStr: 'sound', invTypeStr: 'sound', name: 'boop', folderId: 'dddddddd-0000-0000-0000-000000000004',
		}, Buffer.from([1, 2, 3]), fn)

		expect(res.ok).toBe(true)
		expect(res.itemId).toBe('bbbbbbbb-0000-0000-0000-000000000002')
		const step1 = parseLLSD(calls[0].body) as any
		expect(llsdStr(step1.asset_type)).toBe('sound')
		expect(llsdStr(step1.inventory_type)).toBe('sound')
		expect(llsdStr(step1.folder_id)).toBe('dddddddd-0000-0000-0000-000000000004')
	})
})
