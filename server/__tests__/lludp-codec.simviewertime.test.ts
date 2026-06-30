import { describe, it, expect } from 'bun:test'
import { decodeSimulatorViewerTime } from '../lib/lludp-codec'

// Body per message_template.msg Low 150: UsecSinceStart U64 | SecPerDay U32 | SecPerYear U32 |
// SunDirection LLVector3 | SunPhase F32 | SunAngVelocity LLVector3
describe('decodeSimulatorViewerTime', () => {
	it('decodes Low 150 fields in order', () => {
		const buf = Buffer.alloc(8 + 4 + 4 + 12 + 4 + 12)
		let o = 0
		buf.writeBigUInt64LE(123456789n, o); o += 8
		buf.writeUInt32LE(14400, o); o += 4 // secPerDay
		buf.writeUInt32LE(31536000, o); o += 4 // secPerYear
		buf.writeFloatLE(0.0, o); o += 4 // sunDir x
		buf.writeFloatLE(0.0, o); o += 4 // sunDir y
		buf.writeFloatLE(1.0, o); o += 4 // sunDir z (zenith)
		buf.writeFloatLE(0.25, o); o += 4 // sunPhase
		buf.writeFloatLE(0.0, o); o += 4
		buf.writeFloatLE(0.0, o); o += 4
		buf.writeFloatLE(0.001, o); o += 4 // sunAngVel z

		const r = decodeSimulatorViewerTime(buf, 0)
		expect(r.secPerDay).toBe(14400)
		expect(r.secPerYear).toBe(31536000)
		expect(r.sunDirection).toEqual([0, 0, 1])
		expect(r.sunPhase).toBeCloseTo(0.25)
		expect(r.sunAngVelocity[2]).toBeCloseTo(0.001)
		expect(r.usecSinceStart).toBe(123456789)
	})

	it('respects a nonzero dataOffset', () => {
		const pad = 7
		const buf = Buffer.alloc(pad + 8 + 4 + 4 + 12 + 4 + 12)
		let o = pad
		buf.writeBigUInt64LE(1n, o); o += 8
		buf.writeUInt32LE(600, o); o += 4
		buf.writeUInt32LE(1, o); o += 4
		buf.writeFloatLE(0.5, o); o += 4
		buf.writeFloatLE(0.0, o); o += 4
		buf.writeFloatLE(0.5, o); o += 4
		const r = decodeSimulatorViewerTime(buf, pad)
		expect(r.secPerDay).toBe(600)
		expect(r.sunDirection[0]).toBeCloseTo(0.5)
	})
})
