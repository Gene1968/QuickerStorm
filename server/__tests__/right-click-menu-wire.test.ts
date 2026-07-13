// Right-click-menu sweep — wire tests for the new sit/buy/pay/group-invite messages.
// Encoders: round-trip through the generic template decode() (golden-byte pattern mirrors
// server/__tests__/lludp-codec.derez-take.test.ts). Decoders: build bytes with encode() (both
// AvatarSitResponse and MoneyBalanceReply are fully in message_template.msg) then run the
// hand-written mapXxx() against decode().blocks — mirrors motion-sound-decode.test.ts.
//
// Reference authorities:
// - AvatarSitResponse (High 21, Zerocoded): message_template.msg:3650-3666; FS consumer
//   llviewermessage.cpp:5464-5508 process_avatar_sit_response.
// - ObjectBuy (Low 102, Zerocoded): message_template.msg:2233-2246; FS packer
//   llselectmgr.cpp:5023 sendBuy / :5815-5823 packAgentGroupAndCatID / :5032-5045 packBuyObjectIDs.
// - MoneyTransferRequest (Low 311, Zerocoded): message_template.msg:6915-6931; FS packer
//   llviewermessage.cpp:462-490 give_money. Flags: lltransactionflags.cpp:36-48
//   pack_transaction_flags (SOURCE_GROUP=1, DEST_GROUP=2). Types: lltransactiontypes.h:77/84
//   (TRANS_GIFT=5001, TRANS_PAY_OBJECT=5008).
// - MoneyBalanceRequest/Reply (Low 313/314): message_template.msg:6961-6987; FS
//   llstatusbar.cpp:889-904 sendMoneyBalanceRequest, llviewermessage.cpp:5755-5767
//   process_money_balance_reply.
// - InviteGroupRequest (Low 349, Unencoded): message_template.msg:7712-7731; FS packer
//   llgroupmgr.cpp:1893-1927.
import { describe, it, expect } from 'bun:test'
import {
	encodeObjectBuy, encodeMoneyTransferRequest, encodeMoneyBalanceRequest, encodeInviteGroupRequest,
	mapAvatarSitResponse, mapMoneyBalanceReply,
} from '../lib/lludp-codec'
import { encode, decode } from '../lib/protocol/codec.ts'

const AGENT_ID   = '11112222-3333-4444-5555-666677778888'
const SESSION_ID = 'aaaabbbb-0000-1111-2222-ccccddddeeee'
const DEST_ID    = '99998888-7777-6666-5555-444433332222'
const GROUP_ID   = '55556666-7777-8888-9999-aaaabbbbcccc'
const INVITEE_1  = '00112233-4455-6677-8899-aabbccddeeff'
const INVITEE_2  = 'ffeeddcc-bbaa-9988-7766-554433221100'
const ZERO       = '00000000-0000-0000-0000-000000000000'

// ── ObjectBuy (Low 102) ────────────────────────────────────────────────────

describe('encodeObjectBuy (Low 102, message_template.msg:2233-2246)', () => {
	it('encodes a single ObjectData block with GroupID zero and the given CategoryID', () => {
		const buf = encodeObjectBuy({
			agentId: AGENT_ID, sessionId: SESSION_ID, seq: 1,
			localId: 424242, saleType: 2, salePrice: 500, categoryId: DEST_ID,
		})
		const msg = decode(buf)
		expect(msg.name).toBe('ObjectBuy')
		expect(msg.blocks.AgentData[0].AgentID).toBe(AGENT_ID)
		expect(msg.blocks.AgentData[0].SessionID).toBe(SESSION_ID)
		expect(msg.blocks.AgentData[0].GroupID).toBe(ZERO)
		expect(msg.blocks.AgentData[0].CategoryID).toBe(DEST_ID)
		expect(msg.blocks.ObjectData).toHaveLength(1)
		expect(msg.blocks.ObjectData[0].ObjectLocalID).toBe(424242)
		expect(msg.blocks.ObjectData[0].SaleType).toBe(2)
		expect(msg.blocks.ObjectData[0].SalePrice).toBe(500)
	})

	it('defaults CategoryID to zero-UUID when omitted (sim re-resolves)', () => {
		const buf = encodeObjectBuy({
			agentId: AGENT_ID, sessionId: SESSION_ID, seq: 2,
			localId: 7, saleType: 1, salePrice: 0,
		})
		const msg = decode(buf)
		expect(msg.blocks.AgentData[0].CategoryID).toBe(ZERO)
	})
})

// ── MoneyTransferRequest (Low 311) ─────────────────────────────────────────

describe('encodeMoneyTransferRequest (Low 311, message_template.msg:6915-6931)', () => {
	it('SourceID = paying agent, AggregatePerm* = AP_EMPTY(0), Flags = 0 for an individual', () => {
		const buf = encodeMoneyTransferRequest({
			agentId: AGENT_ID, sessionId: SESSION_ID, seq: 3,
			destId: DEST_ID, amount: 100, transactionType: 5001, description: 'a gift',
		})
		const msg = decode(buf)
		expect(msg.name).toBe('MoneyTransferRequest')
		const md = msg.blocks.MoneyData[0]
		expect(md.SourceID).toBe(AGENT_ID)
		expect(md.DestID).toBe(DEST_ID)
		expect(md.Flags).toBe(0)
		expect(md.Amount).toBe(100)
		expect(md.AggregatePermNextOwner).toBe(0)
		expect(md.AggregatePermInventory).toBe(0)
		expect(md.TransactionType).toBe(5001)
		expect(Buffer.isBuffer(md.Description) ? (md.Description as Buffer).toString('utf8').replace(/\0+$/, '') : md.Description).toBe('a gift')
	})

	it('Flags = 0x02 when isDestGroup (pack_transaction_flags DEST_GROUP bit, lltransactionflags.cpp:37/46)', () => {
		const buf = encodeMoneyTransferRequest({
			agentId: AGENT_ID, sessionId: SESSION_ID, seq: 4,
			destId: DEST_ID, amount: 50, transactionType: 5008, isDestGroup: true,
		})
		const msg = decode(buf)
		expect(msg.blocks.MoneyData[0].Flags).toBe(0x02)
	})
})

// ── MoneyBalanceRequest (Low 313) ──────────────────────────────────────────

describe('encodeMoneyBalanceRequest (Low 313, message_template.msg:6961-6971)', () => {
	it('sends TransactionID = zero-UUID (FS llstatusbar.cpp:897)', () => {
		const buf = encodeMoneyBalanceRequest({ agentId: AGENT_ID, sessionId: SESSION_ID, seq: 5 })
		const msg = decode(buf)
		expect(msg.name).toBe('MoneyBalanceRequest')
		expect(msg.blocks.AgentData[0].AgentID).toBe(AGENT_ID)
		expect(msg.blocks.MoneyData[0].TransactionID).toBe(ZERO)
	})
})

// ── InviteGroupRequest (Low 349) ────────────────────────────────────────────

describe('encodeInviteGroupRequest (Low 349, message_template.msg:7712-7731)', () => {
	it('one InviteData block per invitee, RoleID defaults to zero-UUID (Everyone role)', () => {
		const buf = encodeInviteGroupRequest({
			agentId: AGENT_ID, sessionId: SESSION_ID, seq: 6,
			groupId: GROUP_ID, inviteeIds: [INVITEE_1, INVITEE_2],
		})
		const msg = decode(buf)
		expect(msg.name).toBe('InviteGroupRequest')
		expect(msg.blocks.GroupData[0].GroupID).toBe(GROUP_ID)
		expect(msg.blocks.InviteData).toHaveLength(2)
		expect(msg.blocks.InviteData[0].InviteeID).toBe(INVITEE_1)
		expect(msg.blocks.InviteData[0].RoleID).toBe(ZERO)
		expect(msg.blocks.InviteData[1].InviteeID).toBe(INVITEE_2)
	})

	it('honors an explicit non-default RoleID', () => {
		const roleId = '12341234-1234-1234-1234-123412341234'
		const buf = encodeInviteGroupRequest({
			agentId: AGENT_ID, sessionId: SESSION_ID, seq: 7,
			groupId: GROUP_ID, inviteeIds: [INVITEE_1], roleId,
		})
		const msg = decode(buf)
		expect(msg.blocks.InviteData[0].RoleID).toBe(roleId)
	})
})

// ── AvatarSitResponse (High 21) — decode side ──────────────────────────────

describe('mapAvatarSitResponse (High 21, message_template.msg:3650-3666)', () => {
	it('maps SitObject.ID + SitTransform fields, re-deriving quaternion W', () => {
		// 90° about Z: q = [0, 0, sin45, cos45] — only xyz travel on the wire.
		const pkt = encode('AvatarSitResponse', {
			SitObject: { ID: DEST_ID },
			SitTransform: {
				AutoPilot: true,
				SitPosition: [0.1, 0.2, 0.3],
				SitRotation: [0, 0, 0.7071068, 0.7071068],
				CameraEyeOffset: [1, 2, 3],
				CameraAtOffset: [4, 5, 6],
				ForceMouselook: false,
			},
		}, { seq: 8 })
		const m = decode(pkt)
		expect(m.name).toBe('AvatarSitResponse')
		const d = mapAvatarSitResponse(m.blocks)!
		expect(d).toBeTruthy()
		expect(d.sitObjectId).toBe(DEST_ID)
		expect(d.autoPilot).toBe(true)
		expect(d.sitPosition[0]).toBeCloseTo(0.1, 4)
		expect(d.sitPosition[2]).toBeCloseTo(0.3, 4)
		expect(d.sitRotation[2]).toBeCloseTo(0.7071068, 4)
		expect(d.sitRotation[3]).toBeCloseTo(0.7071068, 4)   // re-derived W
		expect(d.cameraEyeOffset).toEqual([expect.closeTo(1, 4), expect.closeTo(2, 4), expect.closeTo(3, 4)] as unknown as [number, number, number])
		expect(d.cameraAtOffset).toEqual([expect.closeTo(4, 4), expect.closeTo(5, 4), expect.closeTo(6, 4)] as unknown as [number, number, number])
		expect(d.forceMouselook).toBe(false)
	})

	it('re-derives W=1 for an identity rotation', () => {
		const pkt = encode('AvatarSitResponse', {
			SitObject: { ID: DEST_ID },
			SitTransform: {
				AutoPilot: false, SitPosition: [0, 0, 0], SitRotation: [0, 0, 0],
				CameraEyeOffset: [0, 0, 0], CameraAtOffset: [0, 0, 0], ForceMouselook: true,
			},
		}, { seq: 9 })
		const d = mapAvatarSitResponse(decode(pkt).blocks)!
		expect(d.sitRotation).toEqual([0, 0, 0, 1])
		expect(d.forceMouselook).toBe(true)
	})

	it('returns null when blocks are missing (malformed)', () => {
		expect(mapAvatarSitResponse({})).toBeNull()
	})
})

// ── MoneyBalanceReply (Low 314) — decode side ──────────────────────────────

describe('mapMoneyBalanceReply (Low 314, message_template.msg:6976-6986)', () => {
	it('maps balance/credit/committed/description/success', () => {
		const pkt = encode('MoneyBalanceReply', {
			MoneyData: {
				AgentID: AGENT_ID, TransactionID: DEST_ID, TransactionSuccess: true,
				MoneyBalance: 12345, SquareMetersCredit: 512, SquareMetersCommitted: 256,
				Description: Buffer.from('You paid Resident L$100.\0', 'utf8'),
			},
		}, { seq: 10 })
		const m = decode(pkt)
		expect(m.name).toBe('MoneyBalanceReply')
		const d = mapMoneyBalanceReply(m.blocks)!
		expect(d).toBeTruthy()
		expect(d.agentId).toBe(AGENT_ID)
		expect(d.transactionId).toBe(DEST_ID)
		expect(d.success).toBe(true)
		expect(d.balance).toBe(12345)
		expect(d.squareMetersCredit).toBe(512)
		expect(d.squareMetersCommitted).toBe(256)
		expect(d.description).toBe('You paid Resident L$100.')
	})

	it('handles a plain balance update (TransactionSuccess=false, empty description)', () => {
		const pkt = encode('MoneyBalanceReply', {
			MoneyData: {
				AgentID: AGENT_ID, TransactionID: ZERO, TransactionSuccess: false,
				MoneyBalance: 0, SquareMetersCredit: 0, SquareMetersCommitted: 0,
				Description: Buffer.alloc(0),
			},
		}, { seq: 11 })
		const d = mapMoneyBalanceReply(decode(pkt).blocks)!
		expect(d.success).toBe(false)
		expect(d.balance).toBe(0)
		expect(d.description).toBe('')
	})

	it('returns null when MoneyData block is missing (malformed/truncated)', () => {
		expect(mapMoneyBalanceReply({})).toBeNull()
	})
})

// ── RequestObjectPropertiesFamily (Medium 5) / ObjectPropertiesFamily (Medium 10) ─────────────
// Added 2026-07-13 (Gene: Buy pointer only when KNOWN for-sale → hover requests sale info).
// Template: message_template.msg:2714-2730 (request, "driven by mouse hovering") / :3738-3761
// (reply). FS: LLSelectMgr::requestObjectPropertiesFamily; reply consumer
// processObjectPropertiesFamily llselectmgr.cpp:6421-6481.
import { encodeRequestObjectPropertiesFamily, mapObjectPropertiesFamily } from '../lib/lludp-codec'

describe('encodeRequestObjectPropertiesFamily (Medium 5, message_template.msg:2714-2730)', () => {
	it('encodes AgentData + ObjectData{RequestFlags, ObjectID} with default flags 0', () => {
		const buf = encodeRequestObjectPropertiesFamily({
			agentId: AGENT_ID, sessionId: SESSION_ID, seq: 9, objectId: DEST_ID,
		})
		const msg = decode(buf)
		expect(msg.name).toBe('RequestObjectPropertiesFamily')
		expect(String(msg.blocks.AgentData[0].AgentID)).toBe(AGENT_ID)
		expect(String(msg.blocks.AgentData[0].SessionID)).toBe(SESSION_ID)
		expect(Number(msg.blocks.ObjectData[0].RequestFlags)).toBe(0)
		expect(String(msg.blocks.ObjectData[0].ObjectID)).toBe(DEST_ID)
	})
})

describe('mapObjectPropertiesFamily (Medium 10, message_template.msg:3738-3761)', () => {
	it('maps the full ObjectData block including saleType/salePrice and trims Name/Description', () => {
		const buf = encode('ObjectPropertiesFamily', {
			ObjectData: {
				RequestFlags: 0, ObjectID: DEST_ID, OwnerID: AGENT_ID, GroupID: GROUP_ID,
				BaseMask: 0x7fffffff, OwnerMask: 0x7fffffff, GroupMask: 0, EveryoneMask: 0x8000,
				NextOwnerMask: 0x82000, OwnershipCost: 0, SaleType: 2, SalePrice: 150,
				Category: 0, LastOwnerID: INVITEE_1,
				Name: Buffer.from('Vendor Box\0', 'utf8'), Description: Buffer.from('For sale\0', 'utf8'),
			},
		}, { seq: 3 })
		const d = mapObjectPropertiesFamily(decode(buf).blocks)
		expect(d).not.toBeNull()
		expect(d!.fullId).toBe(DEST_ID)
		expect(d!.ownerId).toBe(AGENT_ID)
		expect(d!.saleType).toBe(2)
		expect(d!.salePrice).toBe(150)
		expect(d!.nextOwnerMask).toBe(0x82000)
		expect(d!.name).toBe('Vendor Box')
		expect(d!.description).toBe('For sale')
	})
	it('returns null on a missing ObjectData block', () => {
		expect(mapObjectPropertiesFamily({})).toBeNull()
	})
})
