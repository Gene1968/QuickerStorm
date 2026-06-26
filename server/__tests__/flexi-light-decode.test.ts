import { describe, it, expect } from 'bun:test'
import { parseFlexiExtraParam, parseLightExtraParam, parseReflectionProbeExtraParam } from '../lib/lludp-codec'

// Flexible (ExtraParam 0x10), 16 bytes. Layout per libomv FlexibleData.FromBytes:
//   b0: bit7 = softness bit1, bits0-6 = tension*10
//   b1: bit7 = softness bit0, bits0-6 = drag*10
//   b2: gravity → (byte/10)-10   b3: wind*10   b4..15: force LLVector3 (3 f32le)
describe('parseFlexiExtraParam', () => {
	it('decodes the packed softness/tension/drag/gravity/wind + force', () => {
		const b = Buffer.alloc(16)
		b[0] = 50 | 0x80   // tension 5.0, softness bit1
		b[1] = 30 | 0x80   // drag 3.0, softness bit0
		b[2] = 0           // gravity 0/10 - 10 = -10
		b[3] = 20          // wind 2.0
		b.writeFloatLE(1, 4); b.writeFloatLE(0, 8); b.writeFloatLE(0, 12)  // force [1,0,0]
		const f = parseFlexiExtraParam(b, 0, 16)!
		expect(f.softness).toBe(3)
		expect(f.tension).toBeCloseTo(5.0, 5)
		expect(f.drag).toBeCloseTo(3.0, 5)
		expect(f.gravity).toBeCloseTo(-10.0, 5)
		expect(f.wind).toBeCloseTo(2.0, 5)
		expect(f.force).toEqual([1, 0, 0])
	})
	it('returns null on a short blob', () => {
		expect(parseFlexiExtraParam(Buffer.alloc(8), 0, 8)).toBeNull()
	})
})

// Light (ExtraParam 0x20), 16 bytes. Layout per libomv LightData.FromBytes:
//   RGBA bytes (A = intensity), then radius/cutoff/falloff as 3 f32le.
describe('parseLightExtraParam', () => {
	it('decodes color (A=intensity) + radius/cutoff/falloff', () => {
		const b = Buffer.alloc(16)
		b[0] = 255; b[1] = 128; b[2] = 0; b[3] = 204   // color + intensity 0.8
		b.writeFloatLE(10, 4); b.writeFloatLE(0, 8); b.writeFloatLE(1.5, 12)
		const l = parseLightExtraParam(b, 0, 16)!
		expect(l.color[0]).toBeCloseTo(1, 5)
		expect(l.color[1]).toBeCloseTo(128 / 255, 5)
		expect(l.color[2]).toBeCloseTo(0, 5)
		expect(l.intensity).toBeCloseTo(0.8, 3)
		expect(l.radius).toBeCloseTo(10, 5)
		expect(l.cutoff).toBeCloseTo(0, 5)
		expect(l.falloff).toBeCloseTo(1.5, 5)
	})
	it('returns null on a short blob', () => {
		expect(parseLightExtraParam(Buffer.alloc(8), 0, 8)).toBeNull()
	})
})

// Reflection Probe (ExtraParam 0x90), 9 bytes. Layout per FS LLReflectionProbeParams::unpack:
//   F32 ambiance, F32 clip_distance, U8 flags (bit0 box, bit1 dynamic, bit2 mirror).
describe('parseReflectionProbeExtraParam', () => {
	it('decodes ambiance/clip_distance + the flag bits', () => {
		const b = Buffer.alloc(9)
		b.writeFloatLE(2.5, 0); b.writeFloatLE(64, 4); b[8] = 0x05   // box + mirror, not dynamic
		const p = parseReflectionProbeExtraParam(b, 0, 9)!
		expect(p.ambiance).toBeCloseTo(2.5, 5)
		expect(p.clipDistance).toBeCloseTo(64, 5)
		expect(p.isBox).toBe(true)
		expect(p.isDynamic).toBe(false)
		expect(p.isMirror).toBe(true)
	})
	it('returns null on a short blob', () => {
		expect(parseReflectionProbeExtraParam(Buffer.alloc(4), 0, 4)).toBeNull()
	})
})
