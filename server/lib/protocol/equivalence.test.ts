// Keystone test: prove the generic codec emits the same WIRE BYTES as the proven-on-the-wire
// hand-written encoders — offline, no sim, no server restart. We compare the FIELD DATA (the
// bytes after the LLUDP header + message-id prefix), which is identical for every message,
// including the ones whose hand-written message-id was buggy (only the prefix differs there).
// Six hand-written encoders had latent bugs the template corrects; each is asserted explicitly.
import { describe, it, expect } from 'bun:test'
import { encode } from './codec.ts'
import * as hand from '../lludp-codec.ts'

const A = '11111111-1111-1111-1111-111111111111'
const S = '22222222-2222-2222-2222-222222222222'
const U = '33333333-3333-3333-3333-333333333333'
const seq = 7

// Strip the 6-byte header (test packets carry no extra/ack bytes) and the 1/2/4-byte
// message-id prefix, leaving just the field data.
function idLenOf(body: Buffer): number {
	if (body[0] !== 0xFF) return 1
	if (body[1] !== 0xFF) return 2
	return 4
}
function fieldData(buf: Buffer): Buffer {
	const body = buf.slice(6)
	return body.slice(idLenOf(body))
}
function idBytes(buf: Buffer): number[] {
	const body = buf.slice(6)
	return [...body.slice(0, idLenOf(body))]
}

// Reproduce the hand-written AgentThrottle throttle payload so the bodies match exactly.
const THROTTLES = [150000, 500000, 20000, 20000, 700000, 1300000, 500000]
const throttleBuf = Buffer.alloc(28)
THROTTLES.forEach((v, i) => throttleBuf.writeFloatLE(v, i * 4))

const opt = { seq, reliable: true }

// name → { hand: Buffer, gen: Buffer }. Field data must match byte-for-byte.
const cases: Record<string, { hand: Buffer; gen: Buffer }> = {
	UseCircuitCode: {
		hand: hand.encodeUseCircuitCode({ agentId: A, sessionId: S, circuitCode: 123, seq }),
		gen: encode('UseCircuitCode', { CircuitCode: { Code: 123, SessionID: S, ID: A } }, opt),
	},
	CompleteAgentMovement: {
		hand: hand.encodeCompleteAgentMovement({ agentId: A, sessionId: S, circuitCode: 123, seq }),
		gen: encode('CompleteAgentMovement', { AgentData: { AgentID: A, SessionID: S, CircuitCode: 123 } }, opt),
	},
	LogoutRequest: {
		hand: hand.encodeLogoutRequest({ agentId: A, sessionId: S, seq }),
		gen: encode('LogoutRequest', { AgentData: { AgentID: A, SessionID: S } }, opt),
	},
	AgentThrottle: {
		hand: hand.encodeAgentThrottle({ agentId: A, sessionId: S, circuitCode: 123, seq }),
		gen: encode('AgentThrottle', { AgentData: { AgentID: A, SessionID: S, CircuitCode: 123 }, Throttle: { GenCounter: 0, Throttles: throttleBuf } }, opt),
	},
	AgentHeightWidth: {
		hand: hand.encodeAgentHeightWidth({ agentId: A, sessionId: S, circuitCode: 123, seq }),
		gen: encode('AgentHeightWidth', { AgentData: { AgentID: A, SessionID: S, CircuitCode: 123 }, HeightWidthBlock: { GenCounter: 0, Height: 768, Width: 1024 } }, opt),
	},
	PacketAck: {
		hand: hand.encodePacketAck([100, 200, 300], seq),
		gen: encode('PacketAck', { Packets: [{ ID: 100 }, { ID: 200 }, { ID: 300 }] }, opt),
	},
	CompletePingCheck: {
		hand: hand.encodeCompletePingCheck(42, seq),
		gen: encode('CompletePingCheck', { PingID: { PingID: 42 } }, opt),
	},
	TeleportLocationRequest: {
		hand: hand.encodeTeleportLocationRequest({ agentId: A, sessionId: S, seq, regionHandle: 0x0000010000000200n, x: 128, y: 64, z: 25 }),
		gen: encode('TeleportLocationRequest', { AgentData: { AgentID: A, SessionID: S }, Info: { RegionHandle: 0x0000010000000200n, Position: [128, 64, 25], LookAt: [0, 1, 0] } }, opt),
	},
	RequestMultipleObjects: {
		hand: hand.encodeRequestMultipleObjects({ agentId: A, sessionId: S, seq, ids: [10, 20], cacheMissType: 0 }),
		gen: encode('RequestMultipleObjects', { AgentData: { AgentID: A, SessionID: S }, ObjectData: [{ CacheMissType: 0, ID: 10 }, { CacheMissType: 0, ID: 20 }] }, opt),
	},
	AgentUpdate: {
		hand: hand.encodeAgentUpdate({ agentId: A, sessionId: S, seq, controlFlags: 5, bodyRot: [0.1, 0.2, 0.3], headRot: [0.4, 0.5, 0.6], camCenter: [1, 2, 3], camAt: [0, 1, 0], camLeft: [1, 0, 0], camUp: [0, 0, 1], far: 128 }),
		gen: encode('AgentUpdate', { AgentData: { AgentID: A, SessionID: S, BodyRotation: [0.1, 0.2, 0.3], HeadRotation: [0.4, 0.5, 0.6], State: 0, CameraCenter: [1, 2, 3], CameraAtAxis: [0, 1, 0], CameraLeftAxis: [1, 0, 0], CameraUpAxis: [0, 0, 1], Far: 128, ControlFlags: 5, Flags: 0 } }, opt),
	},
	ObjectSelect: {
		hand: hand.encodeObjectSelect({ agentId: A, sessionId: S, seq, localIds: [55, 66] }),
		gen: encode('ObjectSelect', { AgentData: { AgentID: A, SessionID: S }, ObjectData: [{ ObjectLocalID: 55 }, { ObjectLocalID: 66 }] }, opt),
	},
	ObjectDeselect: {
		hand: hand.encodeObjectDeselect({ agentId: A, sessionId: S, seq, localIds: [55, 66] }),
		gen: encode('ObjectDeselect', { AgentData: { AgentID: A, SessionID: S }, ObjectData: [{ ObjectLocalID: 55 }, { ObjectLocalID: 66 }] }, opt),
	},
	ObjectGrab: {
		hand: hand.encodeObjectGrab({ agentId: A, sessionId: S, seq, localId: 77 }),
		gen: encode('ObjectGrab', { AgentData: { AgentID: A, SessionID: S }, ObjectData: { LocalID: 77, GrabOffset: [0, 0, 0] }, SurfaceInfo: [] }, opt),
	},
	ChatFromViewer: {
		hand: hand.encodeChatFromViewer({ agentId: A, sessionId: S, seq, message: 'hello', chatType: 1, channel: 0 }),
		gen: encode('ChatFromViewer', { AgentData: { AgentID: A, SessionID: S }, ChatData: { Message: Buffer.from('hello', 'utf8'), Type: 1, Channel: 0 } }, opt),
	},
	CreateInventoryFolder: {
		hand: hand.encodeCreateInventoryFolder({ agentId: A, sessionId: S, seq, folderId: U, parentId: A, type: -1, name: 'New Folder' }),
		gen: encode('CreateInventoryFolder', { AgentData: { AgentID: A, SessionID: S }, FolderData: { FolderID: U, ParentID: A, Type: -1, Name: Buffer.from('New Folder\0', 'utf8') } }, opt),
	},
	CreateInventoryItem: {
		hand: hand.encodeCreateInventoryItem({ agentId: A, sessionId: S, seq, callbackId: 0, folderId: U, type: 3, invType: 3, name: 'LM', description: 'd' }),
		gen: encode('CreateInventoryItem', { AgentData: { AgentID: A, SessionID: S }, InventoryBlock: { CallbackID: 0, FolderID: U, TransactionID: '00000000-0000-0000-0000-000000000000', NextOwnerMask: 0x7FFFFFFF, Type: 3, InvType: 3, WearableType: 0, Name: Buffer.from('LM\0', 'utf8'), Description: Buffer.from('d\0', 'utf8') } }, opt),
	},
	MapLayerRequest: {
		hand: hand.encodeMapLayerRequest({ agentId: A, sessionId: S, seq, flags: 0 }),
		gen: encode('MapLayerRequest', { AgentData: { AgentID: A, SessionID: S, Flags: 0, EstateID: 0, Godlike: false } }, opt),
	},
	MapBlockRequest: {
		hand: hand.encodeMapBlockRequest({ agentId: A, sessionId: S, seq, minX: 1000, maxX: 1001, minY: 1000, maxY: 1001 }),
		gen: encode('MapBlockRequest', { AgentData: { AgentID: A, SessionID: S, Flags: 0x00010000, EstateID: 0, Godlike: false }, PositionData: { MinX: 1000, MaxX: 1001, MinY: 1000, MaxY: 1001 } }, opt),
	},
	MapNameRequest: {
		hand: hand.encodeMapNameRequest({ agentId: A, sessionId: S, seq, name: 'Sandbox' }),
		gen: encode('MapNameRequest', { AgentData: { AgentID: A, SessionID: S, Flags: 0x00010000, EstateID: 0, Godlike: false }, NameData: { Name: Buffer.from('Sandbox\0', 'utf8') } }, opt),
	},
	AgentSetAppearance: {
		hand: hand.encodeAgentSetAppearance({ agentId: A, sessionId: S, seq }),
		gen: encode('AgentSetAppearance', { AgentData: { AgentID: A, SessionID: S, SerialNum: 1, Size: [0.45, 0.60, 1.84] }, WearableData: [], ObjectData: { TextureEntry: Buffer.alloc(0) }, VisualParam: [] }, opt),
	},
	RegionHandshakeReply: {
		hand: hand.encodeRegionHandshakeReply({ agentId: A, sessionId: S, seq }),
		gen: encode('RegionHandshakeReply', { AgentData: { AgentID: A, SessionID: S }, RegionInfo: { Flags: 0 } }, opt),
	},
	TeleportLandmarkRequest: {
		hand: hand.encodeTeleportLandmarkRequest({ agentId: A, sessionId: S, landmarkId: U, seq }),
		gen: encode('TeleportLandmarkRequest', { Info: { AgentID: A, SessionID: S, LandmarkID: U } }, opt),
	},
	AvatarPropertiesRequest: {
		hand: hand.encodeAvatarPropertiesRequest({ agentId: A, sessionId: S, avatarId: U, seq }),
		gen: encode('AvatarPropertiesRequest', { AgentData: { AgentID: A, SessionID: S, AvatarID: U } }, opt),
	},
	ParcelInfoRequest: {
		hand: hand.encodeParcelInfoRequest({ agentId: A, sessionId: S, parcelId: U, seq }),
		gen: encode('ParcelInfoRequest', { AgentData: { AgentID: A, SessionID: S }, Data: { ParcelID: U } }, opt),
	},
	UUIDNameRequest: {
		hand: hand.encodeUUIDNameRequest({ ids: [A, S], seq }),
		gen: encode('UUIDNameRequest', { UUIDNameBlock: [{ ID: A }, { ID: S }] }, opt),
	},
	AcceptFriendship: {
		hand: hand.encodeAcceptFriendship({ agentId: A, sessionId: S, transactionId: U, folderId: A, seq }),
		gen: encode('AcceptFriendship', { AgentData: { AgentID: A, SessionID: S }, TransactionBlock: { TransactionID: U }, FolderData: [{ FolderID: A }] }, opt),
	},
	DeclineFriendship: {
		hand: hand.encodeDeclineFriendship({ agentId: A, sessionId: S, transactionId: U, seq }),
		gen: encode('DeclineFriendship', { AgentData: { AgentID: A, SessionID: S }, TransactionBlock: { TransactionID: U } }, opt),
	},
	TerminateFriendship: {
		hand: hand.encodeTerminateFriendship({ agentId: A, sessionId: S, otherId: U, seq }),
		gen: encode('TerminateFriendship', { AgentData: { AgentID: A, SessionID: S }, ExBlock: { OtherID: U } }, opt),
	},
	AvatarPickerRequest: {
		hand: hand.encodeAvatarPickerRequest({ agentId: A, sessionId: S, queryId: U, name: 'Bob', seq }),
		gen: encode('AvatarPickerRequest', { AgentData: { AgentID: A, SessionID: S, QueryID: U }, Data: { Name: Buffer.from('Bob\0', 'utf8') } }, opt),
	},
}

describe('generic codec field data matches hand-written encoders byte-for-byte', () => {
	for (const [name, c] of Object.entries(cases)) {
		it(`${name}`, () => {
			expect(fieldData(c.gen).equals(fieldData(c.hand))).toBe(true)
		})
	}
})

// These five hand-written encoders used the WRONG message-id (the field data is identical,
// only the id prefix was wrong). The template-driven encoder derives the correct id.
describe('template corrects buggy message-ids', () => {
	const A2 = A, S2 = S
	it('SetAlwaysRun: Low 88 (hand-written sent Low 21 = UserReportInternal)', () => {
		const gen = encode('SetAlwaysRun', { AgentData: { AgentID: A2, SessionID: S2, AlwaysRun: true } }, opt)
		const bad = hand.encodeSetAlwaysRun({ agentId: A2, sessionId: S2, seq, alwaysRun: true })
		expect(idBytes(gen)).toEqual([0xFF, 0xFF, 0x00, 0x58]) // 88
		expect(idBytes(bad)).toEqual([0xFF, 0xFF, 0x00, 0x15]) // 21 — documents old bug
		expect(fieldData(gen).equals(fieldData(bad))).toBe(true)
	})
	it('AgentRequestSit: High 6 (hand-written sent Low 122)', () => {
		const gen = encode('AgentRequestSit', { AgentData: { AgentID: A2, SessionID: S2 }, TargetObject: { TargetID: U, Offset: [0, 0, 0] } }, opt)
		const bad = hand.encodeAgentRequestSit({ agentId: A2, sessionId: S2, seq, targetId: U })
		expect(idBytes(gen)).toEqual([0x06])
		expect(idBytes(bad)).toEqual([0xFF, 0xFF, 0x00, 0x7A])
		expect(fieldData(gen).equals(fieldData(bad))).toBe(true)
	})
	it('AgentSit: High 7 (hand-written sent Low 123)', () => {
		const gen = encode('AgentSit', { AgentData: { AgentID: A2, SessionID: S2 } }, opt)
		const bad = hand.encodeAgentSit({ agentId: A2, sessionId: S2, seq })
		expect(idBytes(gen)).toEqual([0x07])
		expect(idBytes(bad)).toEqual([0xFF, 0xFF, 0x00, 0x7B])
		expect(fieldData(gen).equals(fieldData(bad))).toBe(true)
	})
	it('ObjectDeGrab: Low 119 (hand-written sent Low 118 = ObjectGrabUpdate)', () => {
		const gen = encode('ObjectDeGrab', { AgentData: { AgentID: A2, SessionID: S2 }, ObjectData: { LocalID: 77 }, SurfaceInfo: [] }, opt)
		const bad = hand.encodeObjectDeGrab({ agentId: A2, sessionId: S2, seq, localId: 77 })
		expect(idBytes(gen)).toEqual([0xFF, 0xFF, 0x00, 0x77]) // 119
		expect(idBytes(bad)).toEqual([0xFF, 0xFF, 0x00, 0x76]) // 118
		expect(fieldData(gen).equals(fieldData(bad))).toBe(true)
	})
	it('SetStartLocationRequest: Low 324 (hand-written sent Low 204)', () => {
		const gen = encode('SetStartLocationRequest', { AgentData: { AgentID: A2, SessionID: S2 }, StartLocationData: { SimName: Buffer.from('Home', 'utf8'), LocationID: 1, LocationPos: [128, 128, 25], LocationLookAt: [0, 1, 0] } }, opt)
		const bad = hand.encodeSetStartLocationRequest({ agentId: A2, sessionId: S2, seq, simName: 'Home', locationId: 1, x: 128, y: 128, z: 25 })
		expect(idBytes(gen)).toEqual([0xFF, 0xFF, 0x01, 0x44]) // 324
		expect(idBytes(bad)).toEqual([0xFF, 0xFF, 0x00, 0xCC]) // 204
		expect(fieldData(gen).equals(fieldData(bad))).toBe(true)
	})
})

// Two structural divergences: the hand-written encoders were not just mis-numbered, they
// produced the wrong body. The generic versions are template-correct.
describe('template corrects structurally-wrong encoders', () => {
	it('GrantUserRights: Low 320 with SessionID (hand-written sent ChangeUserRights Low 321, no SessionID)', () => {
		const gen = encode('GrantUserRights', { AgentData: { AgentID: A, SessionID: S }, Rights: [{ AgentRelated: U, RelatedRights: 1 }] }, opt)
		expect(idBytes(gen)).toEqual([0xFF, 0xFF, 0x01, 0x40]) // 320
		// field data = AgentID(16) + SessionID(16) + count(1) + AgentRelated(16) + RelatedRights(4)
		expect(fieldData(gen).length).toBe(16 + 16 + 1 + 16 + 4)
	})
	it('ImprovedInstantMessage: Low 254, includes required EstateBlock + MetaData blocks', () => {
		const gen = encode('ImprovedInstantMessage', {
			AgentData: { AgentID: A, SessionID: S },
			MessageBlock: { FromGroup: false, ToAgentID: U, ParentEstateID: 0, RegionID: '00000000-0000-0000-0000-000000000000', Position: [0, 0, 0], Offline: 0, Dialog: 0, ID: U, Timestamp: 0, FromAgentName: Buffer.from('Me\0', 'utf8'), Message: Buffer.from('hi\0', 'utf8'), BinaryBucket: Buffer.alloc(0) },
			EstateBlock: { EstateID: 0 },
			MetaData: [],
		}, opt)
		expect(idBytes(gen)).toEqual([0xFF, 0xFF, 0x00, 0xFE]) // 254
	})
})
