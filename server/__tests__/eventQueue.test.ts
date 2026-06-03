import { describe, it, expect } from 'bun:test'
import { decodeTeleportFinishLLSD } from '../lib/eventQueue'
import { parseLLSD } from '../lib/llsd'

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
}): string {
	const ipBytes = Buffer.from(opts.simIp.split('.').map(Number))            // 4 bytes, network order
	const rhBuf = Buffer.alloc(8); rhBuf.writeBigUInt64BE(opts.regionHandle)  // 8 bytes BE
	const tfBuf = Buffer.alloc(4); tfBuf.writeUInt32BE(opts.teleportFlags)    // 4 bytes BE
	const locBuf = Buffer.alloc(4); locBuf.writeUInt32BE(4)
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
})
