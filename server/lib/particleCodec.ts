// Pure decoder for the LLUDP ObjectUpdate PSBlock (particle system).
// Layout verified against Firestorm indra/llmessage/llpartdata.{cpp,h}.
// Returns floats already converted from the SL fixed-point packing, so the client
// consumes clean values. Never throws; bounds-checked against `len`.

const PS_SYS_DATA_BLOCK_SIZE = 68
const PS_LEGACY_DATA_BLOCK_SIZE = 86
const PS_MAX_DATA_BLOCK_SIZE = 104

export const PS = {
	PATTERN_DROP: 0x01, PATTERN_EXPLODE: 0x02, PATTERN_ANGLE: 0x04,
	PATTERN_ANGLE_CONE: 0x08, PATTERN_ANGLE_CONE_EMPTY: 0x10,
	PART_INTERP_COLOR: 0x01, PART_INTERP_SCALE: 0x02, PART_BOUNCE: 0x04, PART_WIND: 0x08,
	PART_FOLLOW_SRC: 0x10, PART_FOLLOW_VELOCITY: 0x20, PART_TARGET_POS: 0x40,
	PART_EMISSIVE: 0x100, PART_BEAM: 0x200, PART_RIBBON: 0x400,
	PART_DATA_GLOW: 0x10000, PART_DATA_BLEND: 0x20000,
} as const

export interface ParticleSys {
	crc: number; srcFlags: number; pattern: number
	maxAge: number; startAge: number; innerAngle: number; outerAngle: number
	burstRate: number; burstRadius: number; burstSpeedMin: number; burstSpeedMax: number
	burstPartCount: number
	angularVelocity: [number, number, number]; partAccel: [number, number, number]
	texture: string | null; target: string | null
	partFlags: number; partMaxAge: number
	startColor: [number, number, number, number]; endColor: [number, number, number, number]
	startScale: [number, number]; endScale: [number, number]
	startGlow: number; endGlow: number; blendFuncSource: number; blendFuncDest: number
}

const ZERO_UUID = '00000000-0000-0000-0000-000000000000'

function uuidAt(buf: Buffer, p: number): string | null {
	let h = ''
	for (let i = 0; i < 16; i++) h += buf[p + i].toString(16).padStart(2, '0')
	const u = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
	return u === ZERO_UUID ? null : u
}

class Reader {
	off: number; end: number; buf: Buffer; ok = true
	constructor(buf: Buffer, off: number, len: number) { this.buf = buf; this.off = off; this.end = off + len }
	private need(n: number): boolean { if (this.off + n > this.end) { this.ok = false; return false } return true }
	u8(): number { if (!this.need(1)) return 0; return this.buf[this.off++] }
	u16(): number { if (!this.need(2)) return 0; const v = this.buf.readUInt16LE(this.off); this.off += 2; return v }
	u32(): number { if (!this.need(4)) return 0; const v = this.buf.readUInt32LE(this.off); this.off += 4; return v }
	s32(): number { if (!this.need(4)) return 0; const v = this.buf.readInt32LE(this.off); this.off += 4; return v }
	uuid(): string | null { if (!this.need(16)) return null; const u = uuidAt(this.buf, this.off); this.off += 16; return u }
	fixed(signed: boolean, intBits: number, fracBits: number): number {
		const total = intBits + fracBits + (signed ? 1 : 0)
		const raw = total <= 8 ? this.u8() : this.u16()
		let v = raw / (1 << fracBits)
		if (signed) v -= (1 << intBits)
		return v
	}
	rgba(): [number, number, number, number] {
		return [this.u8() / 255, this.u8() / 255, this.u8() / 255, this.u8() / 255]
	}
}

function readSystem(r: Reader): Partial<ParticleSys> {
	const crc = r.u32()
	const srcFlags = r.u32()
	const pattern = r.u8()
	const maxAge = r.fixed(false, 8, 8)
	const startAge = r.fixed(false, 8, 8)
	const innerAngle = r.fixed(false, 3, 5)
	const outerAngle = r.fixed(false, 3, 5)
	const burstRate = Math.max(0.01, r.fixed(false, 8, 8))
	const burstRadius = r.fixed(false, 8, 8)
	const burstSpeedMin = r.fixed(false, 8, 8)
	const burstSpeedMax = r.fixed(false, 8, 8)
	const burstPartCount = r.u8()
	const angularVelocity: [number, number, number] = [r.fixed(true, 8, 7), r.fixed(true, 8, 7), r.fixed(true, 8, 7)]
	const partAccel: [number, number, number] = [r.fixed(true, 8, 7), r.fixed(true, 8, 7), r.fixed(true, 8, 7)]
	const texture = r.uuid()
	const target = r.uuid()
	return { crc, srcFlags, pattern, maxAge, startAge, innerAngle, outerAngle, burstRate, burstRadius, burstSpeedMin, burstSpeedMax, burstPartCount, angularVelocity, partAccel, texture, target }
}

function readPartLegacy(r: Reader): Partial<ParticleSys> {
	const partFlags = r.u32()
	const partMaxAge = r.fixed(false, 8, 8)
	const startColor = r.rgba()
	const endColor = r.rgba()
	const startScale: [number, number] = [r.fixed(false, 3, 5), r.fixed(false, 3, 5)]
	const endScale: [number, number] = [r.fixed(false, 3, 5), r.fixed(false, 3, 5)]
	return { partFlags, partMaxAge, startColor, endColor, startScale, endScale, startGlow: 0, endGlow: 0, blendFuncSource: 7, blendFuncDest: 9 }
}

export function decodeParticleSystem(buf: Buffer, off: number, len: number): ParticleSys | null {
	if (len <= 0 || len > PS_MAX_DATA_BLOCK_SIZE) return null
	if (off + len > buf.length) return null
	const r = new Reader(buf, off, len)
	const legacy = len === PS_LEGACY_DATA_BLOCK_SIZE
	if (!legacy) { const syssize = r.s32(); if (syssize !== PS_SYS_DATA_BLOCK_SIZE) return null }

	const sys = readSystem(r)
	let part: Partial<ParticleSys>
	if (legacy) {
		part = readPartLegacy(r)
	} else {
		r.s32() // partsize (unused; bounds enforced by Reader)
		part = readPartLegacy(r)
		if (((part.partFlags ?? 0) & PS.PART_DATA_GLOW)) { part.startGlow = r.u8() / 255; part.endGlow = r.u8() / 255 }
		if (((part.partFlags ?? 0) & PS.PART_DATA_BLEND)) { part.blendFuncSource = r.u8(); part.blendFuncDest = r.u8() }
	}

	if (!r.ok) return null
	if (!sys.crc) return null
	return { ...sys, ...part } as ParticleSys
}
