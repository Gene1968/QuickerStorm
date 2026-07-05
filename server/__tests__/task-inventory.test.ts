// Task (prim) inventory tests — legacy file parser + RequestTaskInventory/ReplyTaskInventory/
// MoveTaskInventory wire round-trips.
// Writer authority: OpenSim SceneObjectPartInventory.cs:1637 InventoryStringBuilder
// (hex U32 perm masks :1527-1531, asset_id zeroed when perms deny :1550-1575,
//  name/desc end with '|' :1585-1586). Parse model: FS llviewerobject.cpp:3524 loadTaskInvFile
// → llinventory.cpp:738 importLegacyStream + llpermissions.cpp:570.
import { describe, it, expect } from 'bun:test'
import { parseTaskInventory } from '../lib/taskInventory'
import {
	encodeRequestTaskInventory, encodeMoveTaskInventory, mapReplyTaskInventory,
} from '../lib/lludp-codec'
import { encode, decode } from '../lib/protocol/codec.ts'

const AGENT_ID   = '11112222-3333-4444-5555-666677778888'
const SESSION_ID = 'aaaabbbb-0000-1111-2222-ccccddddeeee'
const TASK_ID    = 'deadbeef-0001-4000-8000-000000000001'
const ZERO       = '00000000-0000-0000-0000-000000000000'
const CREATOR    = 'c0ffee00-0000-4000-8000-00000000c0de'
const OWNER      = 'ab1e0000-0000-4000-8000-0000000000ab'

// Fixture mirrors InventoryStringBuilder output byte-for-byte in structure: inv_object header,
// then a script (asset_id withheld → ZERO), a notecard, and a texture. Trailing-pipe names,
// hex masks, group_owned flag, sale_info sub-block.
const FIXTURE = [
	'\tinv_object\t0',
	'\t{',
	`\t\tobj_id\t${TASK_ID}`,
	`\t\tparent_id\t${ZERO}`,
	'\t\ttype\tcategory',
	'\t\tname\tContents|',
	'\t}',
	// ── script — no-copy → asset_id zeroed by the sim (SceneObjectPartInventory.cs:1560-1562) ──
	'\tinv_item\t0',
	'\t{',
	'\t\titem_id\t11111111-aaaa-4000-8000-000000000011',
	`\t\tparent_id\t${TASK_ID}`,
	'\tpermissions 0',
	'\t{',
	'\t\tbase_mask\t7fffffff',
	'\t\towner_mask\t7fffffff',
	'\t\tgroup_mask\t00000000',
	'\t\teveryone_mask\t00000000',
	'\t\tnext_owner_mask\t0008e000',
	`\t\tcreator_id\t${CREATOR}`,
	`\t\tlast_owner_id\t${OWNER}`,
	`\t\tgroup_id\t${ZERO}`,
	`\t\towner_id\t${OWNER}`,
	'\t\tgroup_owned\t0',
	'\t}',
	`\t\tasset_id\t${ZERO}`,
	'\t\ttype\tlsltext',
	'\t\tinv_type\tscript',
	'\t\tflags\t00000000',
	'\tsale_info\t0',
	'\t{',
	'\t\tsale_type\tnot',
	'\t\tsale_price\t0',
	'\t}',
	'\t\tname\tMy Rotation Script|',
	'\t\tdesc\t2026-07-01 12:00:00 lsl2 script|',
	'\t\tcreation_date\t1751400000',
	'\t}',
	// ── notecard — copy+mod → asset_id present ──
	'\tinv_item\t0',
	'\t{',
	'\t\titem_id\t22222222-bbbb-4000-8000-000000000022',
	`\t\tparent_id\t${TASK_ID}`,
	'\tpermissions 0',
	'\t{',
	'\t\tbase_mask\t7fffffff',
	'\t\towner_mask\t0008e000',
	'\t\tgroup_mask\t00000000',
	'\t\teveryone_mask\t00080000',
	'\t\tnext_owner_mask\t00082000',
	`\t\tcreator_id\t${CREATOR}`,
	`\t\tlast_owner_id\t${OWNER}`,
	`\t\tgroup_id\t${ZERO}`,
	`\t\towner_id\t${OWNER}`,
	'\t\tgroup_owned\t0',
	'\t}',
	'\t\tasset_id\t33333333-cccc-4000-8000-000000000033',
	'\t\ttype\tnotecard',
	'\t\tinv_type\tnotecard',
	'\t\tflags\t00000000',
	'\tsale_info\t0',
	'\t{',
	'\t\tsale_type\tnot',
	'\t\tsale_price\t0',
	'\t}',
	'\t\tname\tRead Me First|',
	'\t\tdesc\t|',                     // empty desc = bare pipe (FS "IW: sscanf chokes" guard)
	'\t\tcreation_date\t1751400001',
	'\t}',
	// ── texture ──
	'\tinv_item\t0',
	'\t{',
	'\t\titem_id\t44444444-dddd-4000-8000-000000000044',
	`\t\tparent_id\t${TASK_ID}`,
	'\tpermissions 0',
	'\t{',
	'\t\tbase_mask\t0008e000',
	'\t\towner_mask\t0008e000',
	'\t\tgroup_mask\t00000000',
	'\t\teveryone_mask\t00000000',
	'\t\tnext_owner_mask\t0008e000',
	`\t\tcreator_id\t${CREATOR}`,
	`\t\tlast_owner_id\t${OWNER}`,
	`\t\tgroup_id\t${CREATOR}`,
	`\t\towner_id\t${ZERO}`,           // group-owned form (SceneObjectPartInventory.cs:1537-1541)
	'\t\tgroup_owned\t1',
	'\t}',
	'\t\tasset_id\t55555555-eeee-4000-8000-000000000055',
	'\t\ttype\ttexture',
	'\t\tinv_type\ttexture',
	'\t\tflags\t00000100',
	'\tsale_info\t0',
	'\t{',
	'\t\tsale_type\tnot',
	'\t\tsale_price\t0',
	'\t}',
	'\t\tname\tWood Grain | Dark|',    // pipe INSIDE a name is cut at the first pipe (FS %254[^|])
	'\t\tdesc\tSeamless 1024|',
	'\t\tcreation_date\t1751400002',
	'\t}',
	'',
].join('\n')

describe('parseTaskInventory — script + notecard + texture fixture', () => {
	const items = parseTaskInventory(FIXTURE)

	it('parses 3 items and skips the inv_object Contents row', () => {
		expect(items).toHaveLength(3)
	})

	it('script: hex masks, zeroed asset_id, lsltext/script types', () => {
		const s = items[0]
		expect(s.itemId).toBe('11111111-aaaa-4000-8000-000000000011')
		expect(s.parentId).toBe(TASK_ID)
		expect(s.assetId).toBe(ZERO)              // perms-denied asset id
		expect(s.assetType).toBe(10)              // AT_LSL_TEXT (llassettype.h:73)
		expect(s.invType).toBe(10)                // IT_LSL (llinventorytype.h:53)
		expect(s.baseMask).toBe(0x7fffffff)
		expect(s.ownerMask).toBe(0x7fffffff)
		expect(s.nextOwnerMask).toBe(0x0008e000)
		expect(s.creatorId).toBe(CREATOR)
		expect(s.ownerId).toBe(OWNER)
		expect(s.groupOwned).toBe(false)
		expect(s.name).toBe('My Rotation Script')  // trailing pipe stripped
		expect(s.desc).toBe('2026-07-01 12:00:00 lsl2 script')
		expect(s.creationDate).toBe(1751400000)
		expect(s.saleType).toBe(0)
	})

	it('notecard: asset_id present, empty desc from bare pipe', () => {
		const n = items[1]
		expect(n.assetId).toBe('33333333-cccc-4000-8000-000000000033')
		expect(n.assetType).toBe(7)               // AT_NOTECARD
		expect(n.invType).toBe(7)                 // IT_NOTECARD
		expect(n.everyoneMask).toBe(0x00080000)
		expect(n.name).toBe('Read Me First')
		expect(n.desc).toBe('')
	})

	it('texture: group-owned, flags hex, mid-name pipe cut at first pipe', () => {
		const t = items[2]
		expect(t.assetType).toBe(0)               // AT_TEXTURE
		expect(t.invType).toBe(0)                 // IT_TEXTURE
		expect(t.flags).toBe(0x100)
		expect(t.groupOwned).toBe(true)
		expect(t.groupId).toBe(CREATOR)
		expect(t.name).toBe('Wood Grain ')        // cut at first '|' like FS %254[^|]
		expect(t.desc).toBe('Seamless 1024')
	})

	it('empty/garbage input → no items', () => {
		expect(parseTaskInventory('')).toHaveLength(0)
		expect(parseTaskInventory('random\nnoise\n{')).toHaveLength(0)
	})
})

describe('RequestTaskInventory (Low 289) / MoveTaskInventory (Low 288) encoders', () => {
	it('RequestTaskInventory round-trips AgentData + InventoryData.LocalID', () => {
		const msg = decode(encodeRequestTaskInventory({ agentId: AGENT_ID, sessionId: SESSION_ID, seq: 1, localId: 987654 }))
		expect(msg.name).toBe('RequestTaskInventory')
		expect(msg.blocks.AgentData[0].AgentID).toBe(AGENT_ID)
		expect(msg.blocks.InventoryData[0].LocalID).toBe(987654)
	})

	it('MoveTaskInventory round-trips FolderID + LocalID + ItemID (llviewerobject.cpp:2931 field order)', () => {
		const msg = decode(encodeMoveTaskInventory({
			agentId: AGENT_ID, sessionId: SESSION_ID, seq: 2,
			folderId: 'f01de400-0000-4000-8000-00000000000f', localId: 4242,
			itemId: '11111111-aaaa-4000-8000-000000000011',
		}))
		expect(msg.name).toBe('MoveTaskInventory')
		expect(msg.blocks.AgentData[0].FolderID).toBe('f01de400-0000-4000-8000-00000000000f')
		expect(msg.blocks.InventoryData[0].LocalID).toBe(4242)
		expect(msg.blocks.InventoryData[0].ItemID).toBe('11111111-aaaa-4000-8000-000000000011')
	})
})

describe('mapReplyTaskInventory (Low 290)', () => {
	const build = (filename: string, serial = 3) => encode('ReplyTaskInventory', {
		InventoryData: { TaskID: TASK_ID, Serial: serial, Filename: Buffer.from(filename + (filename ? '\0' : ''), 'utf8') },
	}, { seq: 1, reliable: false })

	it('maps TaskID/Serial/Filename (null-terminator scrubbed)', () => {
		const r = mapReplyTaskInventory(decode(build('inventory_1234.tmp')).blocks)
		expect(r).toEqual({ taskId: TASK_ID, serial: 3, filename: 'inventory_1234.tmp' })
	})

	it('empty filename = empty prim (SceneObjectPartInventory.cs:1465 sends Serial 0 + empty bytes)', () => {
		const r = mapReplyTaskInventory(decode(build('', 0)).blocks)
		expect(r).toEqual({ taskId: TASK_ID, serial: 0, filename: '' })
	})
})
