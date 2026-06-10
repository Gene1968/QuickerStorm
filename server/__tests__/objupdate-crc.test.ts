import { describe, it, expect } from 'bun:test'
import { decodeObjectUpdateCached, decodeObjectUpdateCompressed } from '../lib/lludp-codec'

function buildCachedPacket(entries: Array<[number, number]>): { buf: Buffer; off: number } {
	// dataOffset points at RegionHandle. Layout: RegionHandle(8) TimeDilation(2) count(1) then
	// per entry: localId(4) crc(4) updateFlags(4) = 12 bytes.
	const buf = Buffer.alloc(8 + 2 + 1 + entries.length * 12)
	let p = 11 // 8 + 2 + 1
	buf[10] = entries.length // count
	for (const [localId, crc] of entries) {
		buf.writeUInt32LE(localId, p); p += 4
		buf.writeUInt32LE(crc, p); p += 4
		buf.writeUInt32LE(0, p); p += 4 // updateFlags
	}
	return { buf, off: 0 }
}

describe('decodeObjectUpdateCached', () => {
	it('returns localId+crc pairs and skips localId 0', () => {
		const { buf, off } = buildCachedPacket([[101, 5555], [0, 9], [202, 6666]])
		expect(decodeObjectUpdateCached(buf, off)).toEqual([
			{ localId: 101, crc: 5555 },
			{ localId: 202, crc: 6666 },
		])
	})
})

describe('decodeObjectUpdateCompressed crc', () => {
	it('surfaces the per-object crc', () => {
		const dataLen = 64
		const buf = Buffer.alloc(8 + 2 + 1 + 4 + 2 + dataLen)
		let p = 0
		buf.writeBigUInt64LE(0n, p); p += 8   // RegionHandle
		buf.writeUInt16LE(0, p); p += 2       // TimeDilation
		buf[p++] = 1                          // count
		buf.writeUInt32LE(0, p); p += 4       // UpdateFlags
		buf.writeUInt16LE(dataLen, p); p += 2 // dataLen
		const dataStart = p
		buf.writeUInt32LE(7777, dataStart + 16)      // localId
		buf[dataStart + 20] = 9                       // pcode (prim)
		buf[dataStart + 21] = 0                       // state
		buf.writeUInt32LE(123456, dataStart + 22)     // crc
		const objs = decodeObjectUpdateCompressed(buf, 0)
		expect(objs[0]?.crc).toBe(123456)
	})
})
