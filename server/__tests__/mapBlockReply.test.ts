import { describe, it, expect } from 'bun:test'
import { decodeMapBlockReply } from '../lib/lludp-codec'

// MapBlockReply body: AgentID(16) | Flags U32 | Data count U8 ×
// { X U16, Y U16, Name V1, Access U8, RegionFlags U32, WaterHeight U8, Agents U8, MapImageID UUID }
// | Size count U8 × { SizeX U16, SizeY U16 } — OpenSim writes count=0 when all blocks are 256m.
function buildBody(blocks: Array<{ x: number; y: number; name: string }>, sizes: Array<[number, number]> | null): Buffer {
	const parts: Buffer[] = []
	parts.push(Buffer.alloc(16))                           // AgentID
	parts.push(Buffer.alloc(4))                            // Flags
	parts.push(Buffer.from([blocks.length]))               // Data count
	for (const b of blocks) {
		const head = Buffer.alloc(4)
		head.writeUInt16LE(b.x, 0)
		head.writeUInt16LE(b.y, 2)
		const name = Buffer.from(b.name + '\0', 'utf8')
		const tail = Buffer.alloc(1 + 4 + 1 + 1 + 16)
		tail[0] = 21                                        // Access (Mature)
		parts.push(head, Buffer.from([name.length]), name, tail)
	}
	if (sizes !== null) {
		parts.push(Buffer.from([sizes.length]))             // Size count
		for (const [sx, sy] of sizes) {
			const sz = Buffer.alloc(4)
			sz.writeUInt16LE(sx, 0)
			sz.writeUInt16LE(sy, 2)
			parts.push(sz)
		}
	}
	return Buffer.concat(parts)
}

describe('decodeMapBlockReply Size block (var regions)', () => {
	it('applies SizeX/SizeY from the trailing Size block', () => {
		const body = buildBody(
			[{ x: 1000, y: 1000, name: 'BigVar' }, { x: 1004, y: 1000, name: 'Normal' }],
			[[512, 512], [256, 256]],
		)
		const out = decodeMapBlockReply(body, 0)
		expect(out.length).toBe(2)
		expect(out[0].sizeX).toBe(512)
		expect(out[0].sizeY).toBe(512)
		expect(out[1].sizeX).toBe(256)
		expect(out[1].sizeY).toBe(256)
	})

	it('defaults to 256 when the Size block is count=0 (all-standard reply)', () => {
		const body = buildBody([{ x: 1000, y: 1000, name: 'Normal' }], [])
		// count=0 written explicitly by OpenSim — overwrite the size count byte path
		const out = decodeMapBlockReply(body, 0)
		expect(out[0].sizeX).toBe(256)
		expect(out[0].sizeY).toBe(256)
	})

	it('defaults to 256 when the Size block is absent entirely', () => {
		const body = buildBody([{ x: 1000, y: 1000, name: 'Normal' }], null)
		const out = decodeMapBlockReply(body, 0)
		expect(out[0].sizeX).toBe(256)
		expect(out[0].sizeY).toBe(256)
	})

	it('ignores trailing garbage that does not match the Data count (appended-ack safety)', () => {
		const body = buildBody([{ x: 1000, y: 1000, name: 'Normal' }], null)
		// simulate appended-ack bytes: bogus count + partial data
		const garbage = Buffer.from([7, 0xde, 0xad])
		const out = decodeMapBlockReply(Buffer.concat([body, garbage]), 0)
		expect(out[0].sizeX).toBe(256)
		expect(out[0].sizeY).toBe(256)
	})
})
