import { describe, it, expect } from 'bun:test'
import { decodeTeleportFinishLLSD, eqRegistry } from '../lib/eventQueue'
import { parseLLSD } from '../lib/llsd'
import { createSession, deleteSession, type CircuitState } from '../state/sessions'
import { S } from '../../shared/protocol.js'

// Build the LLSD body OpenSim's EventQueueHelper.TeleportFinishEvent produces:
//   { Info: [ { AgentID, LocationID(bin BE), RegionHandle(bin BE), SeedCapability(str),
//              SimAccess(int), SimIP(bin BE), SimPort(int), TeleportFlags(bin BE) } ] }
function buildBody(opts: {
	simIp: string
	simPort: number
	regionHandle: bigint
	seedCap: string
	simAccess: number
	teleportFlags: number
	regionSizeX?: number   // var-region size — present on modern OpenSim/SL TeleportFinish events
	regionSizeY?: number
}): string {
	const ipBytes = Buffer.from(opts.simIp.split('.').map(Number))            // 4 bytes, network order
	const rhBuf = Buffer.alloc(8); rhBuf.writeBigUInt64BE(opts.regionHandle)  // 8 bytes BE
	const tfBuf = Buffer.alloc(4); tfBuf.writeUInt32BE(opts.teleportFlags)    // 4 bytes BE
	const locBuf = Buffer.alloc(4); locBuf.writeUInt32BE(4)
	const sizeXml =
		(opts.regionSizeX !== undefined ? `<key>RegionSizeX</key><integer>${opts.regionSizeX}</integer>` : '') +
		(opts.regionSizeY !== undefined ? `<key>RegionSizeY</key><integer>${opts.regionSizeY}</integer>` : '')
	return (
		`<?xml version="1.0"?>\n<llsd><map><key>Info</key><array><map>` +
		`<key>AgentID</key><uuid>11111111-2222-3333-4444-555555555555</uuid>` +
		`<key>LocationID</key><binary encoding="base64">${locBuf.toString('base64')}</binary>` +
		`<key>RegionHandle</key><binary encoding="base64">${rhBuf.toString('base64')}</binary>` +
		`<key>SeedCapability</key><string>${opts.seedCap}</string>` +
		`<key>SimAccess</key><integer>${opts.simAccess}</integer>` +
		`<key>SimIP</key><binary encoding="base64">${ipBytes.toString('base64')}</binary>` +
		`<key>SimPort</key><integer>${opts.simPort}</integer>` +
		`<key>TeleportFlags</key><binary encoding="base64">${tfBuf.toString('base64')}</binary>` +
		sizeXml +
		`</map></array></map></llsd>`
	)
}

describe('decodeTeleportFinishLLSD', () => {
	it('decodes a DigiWorldz-style cross-region TeleportFinish event body', () => {
		const handle = (29998n * 256n << 32n) | (35000n * 256n)
		const xml = buildBody({
			simIp: '192.168.1.50',
			simPort: 9000,
			regionHandle: handle,
			seedCap: 'http://sim.example:9000/CAPS/abc123/',
			simAccess: 13,
			teleportFlags: 16,
		})
		const body = (parseLLSD(xml) as Record<string, unknown>)
		const f = decodeTeleportFinishLLSD(body)
		expect(f).not.toBeNull()
		expect(f!.simIp).toBe('192.168.1.50')
		expect(f!.simPort).toBe(9000)
		expect(f!.regionHandle).toBe(handle)
		expect(f!.seedCap).toBe('http://sim.example:9000/CAPS/abc123/')
		expect(f!.simAccess).toBe(13)
		expect(f!.teleportFlags).toBe(16)
	})

	it('accepts the event wrapped as a full EventQueueGet poll response', () => {
		const handle = 0x0001D5A0_000088B8n
		const inner = buildBody({
			simIp: '10.0.0.1', simPort: 9020, regionHandle: handle,
			seedCap: 'http://x/', simAccess: 13, teleportFlags: 0,
		})
		// Extract just the <map>…</map> Info body to embed inside an events array.
		const bodyXml = inner.replace(/^[\s\S]*?<llsd>/, '').replace(/<\/llsd>\s*$/, '')
		const pollXml =
			`<?xml version="1.0"?>\n<llsd><map>` +
			`<key>events</key><array><map>` +
			`<key>message</key><string>TeleportFinish</string>` +
			`<key>body</key>${bodyXml}` +
			`</map></array>` +
			`<key>id</key><integer>1</integer>` +
			`</map></llsd>`
		const poll = parseLLSD(pollXml) as { events: { message: string; body: unknown }[]; id: number }
		expect(poll.id).toBe(1)
		expect(poll.events[0].message).toBe('TeleportFinish')
		const f = decodeTeleportFinishLLSD(poll.events[0].body as Record<string, unknown>)
		expect(f!.simIp).toBe('10.0.0.1')
		expect(f!.simPort).toBe(9020)
		expect(f!.regionHandle).toBe(handle)
	})

	it('returns null for a body with no Info block', () => {
		expect(decodeTeleportFinishLLSD({ foo: 'bar' })).toBeNull()
		expect(decodeTeleportFinishLLSD(null)).toBeNull()
	})

	// Var-region fix (2026-06-19): a 1024×1024 region walled the avatar at Y=511 because regionSize
	// stayed at the login value (512). The authoritative current-region size on a teleport is in the
	// EQ TeleportFinish RegionSizeX/RegionSizeY fields (modern OpenSim/SL). Decode them so the client
	// movement clamp uses the real size. See docs/superpowers/specs/2026-06-19-varregion-size-on-tp-design.md.
	it('decodes var-region RegionSizeX/RegionSizeY when present', () => {
		const handle = (9961n * 256n << 32n) | (10085n * 256n)   // Bountiful Sandbox cell
		const body = parseLLSD(buildBody({
			simIp: '46.4.91.94', simPort: 12054, regionHandle: handle,
			seedCap: 'http://x/', simAccess: 13, teleportFlags: 0,
			regionSizeX: 1024, regionSizeY: 1024,
		})) as Record<string, unknown>
		const f = decodeTeleportFinishLLSD(body)
		expect(f!.regionSizeX).toBe(1024)
		expect(f!.regionSizeY).toBe(1024)
	})

	it('reports regionSize 0 (unknown) when the event omits the size fields', () => {
		const body = parseLLSD(buildBody({
			simIp: '10.0.0.1', simPort: 9000, regionHandle: 1n,
			seedCap: 'http://x/', simAccess: 13, teleportFlags: 0,
		})) as Record<string, unknown>
		const f = decodeTeleportFinishLLSD(body)
		expect(f!.regionSizeX).toBe(0)
		expect(f!.regionSizeY).toBe(0)
	})
})

describe('eqRegistry', () => {
	it('has dedicated handlers for the known events', () => {
		expect(eqRegistry.has('TeleportFinish')).toBe(true)
		expect(eqRegistry.has('TeleportFailed')).toBe(true)
		expect(eqRegistry.has('EnableSimulator')).toBe(true)
	})
	it('does not register a generic-only event', () => {
		expect(eqRegistry.has('SomeFutureEvent')).toBe(false)
	})
	it('registers a dedicated BulkUpdateInventory handler (EQ path for the rename/move ack)', () => {
		expect(eqRegistry.has('BulkUpdateInventory')).toBe(true)
	})
})

// BulkUpdateInventory ack over the EventQueue: on OpenSim the reply after a rename/move/perms/trash
// mutation is delivered here as LLSD (LLClientView.cs SendBulkUpdateInventory ~13294), NOT as a UDP
// BulkUpdateInventory (Low 281) packet. The handler must decode it and emit S.INV_BULK_UPDATE with
// the SAME { folders, items } envelope the UDP path produces, so the client can't tell EQ from UDP.
describe('eqRegistry BulkUpdateInventory (LLSD path)', () => {
	// Build the LLSD body OpenSim emits: FolderData[] + ItemData[] maps with <uuid>/<integer> leaves.
	function buildBulkBody(): unknown {
		const xml =
			`<?xml version="1.0"?>\n<llsd><map>` +
			`<key>AgentData</key><array><map>` +
				`<key>AgentID</key><uuid>11111111-2222-3333-4444-555555555555</uuid>` +
				`<key>TransactionID</key><uuid>00000000-0000-0000-0000-000000000000</uuid>` +
			`</map></array>` +
			`<key>FolderData</key><array><map>` +
				`<key>FolderID</key><uuid>aaaaaaaa-0000-0000-0000-000000000001</uuid>` +
				`<key>ParentID</key><uuid>bbbbbbbb-0000-0000-0000-000000000002</uuid>` +
				`<key>Type</key><integer>-1</integer>` +
				`<key>Name</key><string>Renamed Folder</string>` +
			`</map></array>` +
			`<key>ItemData</key><array><map>` +
				`<key>ItemID</key><uuid>cccccccc-0000-0000-0000-000000000003</uuid>` +
				`<key>CallbackID</key><integer>0</integer>` +
				`<key>FolderID</key><uuid>aaaaaaaa-0000-0000-0000-000000000001</uuid>` +
				`<key>CreatorID</key><uuid>11111111-2222-3333-4444-555555555555</uuid>` +
				`<key>OwnerID</key><uuid>11111111-2222-3333-4444-555555555555</uuid>` +
				`<key>GroupID</key><uuid>00000000-0000-0000-0000-000000000000</uuid>` +
				`<key>BaseMask</key><integer>581632</integer>` +
				`<key>OwnerMask</key><integer>581632</integer>` +
				`<key>GroupMask</key><integer>0</integer>` +
				`<key>EveryoneMask</key><integer>0</integer>` +
				`<key>NextOwnerMask</key><integer>532480</integer>` +
				`<key>GroupOwned</key><boolean>false</boolean>` +
				`<key>AssetID</key><uuid>dddddddd-0000-0000-0000-000000000004</uuid>` +
				`<key>Type</key><integer>5</integer>` +
				`<key>InvType</key><integer>7</integer>` +
				`<key>Flags</key><integer>0</integer>` +
				`<key>SaleType</key><integer>0</integer>` +
				`<key>SalePrice</key><integer>0</integer>` +
				`<key>Name</key><string>Renamed Note</string>` +
				`<key>Description</key><string>desc text</string>` +
				`<key>CreationDate</key><integer>1700000000</integer>` +
				`<key>CRC</key><integer>123456</integer>` +
			`</map></array>` +
			`</map></llsd>`
		return parseLLSD(xml)
	}

	it('decodes a mock OpenSim LLSD body and dispatches S.INV_BULK_UPDATE', () => {
		const sent: { t: string; d: { folders: unknown[]; items: unknown[] } }[] = []
		const sessionId = 'test-bulk-eq'
		// Minimal mock session: handler only touches ws.send (S.INV_BULK_UPDATE + slog DEBUG lines).
		createSession(sessionId, {
			ws: { send: (s: string) => { sent.push(JSON.parse(s)) } },
		} as unknown as CircuitState)
		try {
			eqRegistry.get('BulkUpdateInventory')!(sessionId, buildBulkBody())
		} finally {
			deleteSession(sessionId)
		}

		const update = sent.find(m => m.t === S.INV_BULK_UPDATE)
		expect(update).toBeDefined()
		expect(update!.d.folders).toEqual([
			{ folderId: 'aaaaaaaa-0000-0000-0000-000000000001', parentId: 'bbbbbbbb-0000-0000-0000-000000000002', name: 'Renamed Folder', typeDefault: -1 },
		])
		expect(update!.d.items).toEqual([
			{
				itemId:    'cccccccc-0000-0000-0000-000000000003',
				parentId:  'aaaaaaaa-0000-0000-0000-000000000001',
				assetId:   'dddddddd-0000-0000-0000-000000000004',
				name:      'Renamed Note',
				desc:      'desc text',
				assetType: 5,
				invType:   7,
				flags:     0,
				createdAt: 1700000000,
				ownerMask: 581632,
			},
		])
	})

	it('does not dispatch when the body has no folders or items', () => {
		const sent: { t: string }[] = []
		const sessionId = 'test-bulk-eq-empty'
		createSession(sessionId, {
			ws: { send: (s: string) => { sent.push(JSON.parse(s)) } },
		} as unknown as CircuitState)
		try {
			eqRegistry.get('BulkUpdateInventory')!(sessionId, { FolderData: [], ItemData: [] })
		} finally {
			deleteSession(sessionId)
		}
		expect(sent.some(m => m.t === S.INV_BULK_UPDATE)).toBe(false)
	})
})
