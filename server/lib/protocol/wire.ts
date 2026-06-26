// server/lib/protocol/wire.ts — low-level LLUDP wire helpers shared by the codec.
// Extracted from lludp-codec.ts so protocol/ is self-contained (codec.ts/fields.ts no longer
// reach back into the big codec file, which would create an import cycle once its encoders
// delegate to the generic codec). lludp-codec.ts re-exports these for backward compatibility.
// Reference: http://wiki.secondlife.com/wiki/LLUDP

// ── Flags — LLUDP spec (wiki.secondlife.com/wiki/LLUDP, LibOpenMetaverse) ──
// WHY: Flags are bit-significant. Previous values (0x10/0x40/0x01) were wrong:
//   0x10 = MSG_APPENDED_ACKS (not Reliable!) → sim crashed with IndexOutOfRange
//   parsing appended acks from our reliable packet bodies.
const FLAG_ZERO_CODED = 0x80 // body is zero-coded
const FLAG_RELIABLE   = 0x40 // packet must be ACKed by receiver
const FLAG_RESEND     = 0x20 // retransmit of a reliable packet
const FLAG_HAS_ACKS   = 0x10 // appended ACK list at end of packet

// ── UUID helpers ─────────────────────────────────────────────────────────
export function uuidToBytes(uuid: string): Buffer {
	return Buffer.from(uuid.replace(/-/g, ''), 'hex')
}

export function bytesToUuid(buf: Buffer, offset = 0): string {
	const h = buf.slice(offset, offset + 16).toString('hex')
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

// ── Zero coding ──────────────────────────────────────────────────────────
export function decodeZeroCoded(buf: Buffer): Buffer {
	const out: number[] = []
	for (let i = 0; i < buf.length; i++) {
		if (buf[i] === 0x00) {
			const count = buf[++i] ?? 1
			// WHY: count=0 means 256 zeros per LLUDP spec (LibOpenMetaverse ZeroDecode).
			// Without this, 00 00 produces 0 zeros instead of 256, truncating the decoded
			// buffer and causing OOB errors in ObjectUpdate trailing fields (ExtraParams, Sound, etc.).
			const zeros = count === 0 ? 256 : count
			for (let z = 0; z < zeros; z++) out.push(0x00)
		} else {
			out.push(buf[i])
		}
	}
	return Buffer.from(out)
}

export function encodeZeroCoded(buf: Buffer): Buffer {
	const out: number[] = []
	let i = 0
	while (i < buf.length) {
		if (buf[i] === 0x00) {
			let count = 0
			while (i < buf.length && buf[i] === 0x00 && count < 255) { count++; i++ }
			out.push(0x00, count)
		} else {
			out.push(buf[i++])
		}
	}
	return Buffer.from(out)
}

// ── Header ───────────────────────────────────────────────────────────────
export interface HeaderOpts { seq: number; reliable: boolean; hasAcks: boolean; zeroCoded: boolean }

export function buildHeader(o: HeaderOpts): Buffer {
	const flags = (o.reliable  ? FLAG_RELIABLE  : 0)
		| (o.hasAcks   ? FLAG_HAS_ACKS   : 0)
		| (o.zeroCoded ? FLAG_ZERO_CODED : 0)
	const hdr = Buffer.alloc(6)
	hdr[0] = flags
	hdr.writeUInt32BE(o.seq, 1)
	hdr[5] = 0 // no extra bytes
	return hdr
}

export interface ParsedHeader {
	flags:      number
	reliable:   boolean
	hasAcks:    boolean
	zeroCoded:  boolean
	seq:        number
	extraBytes: number
	bodyOffset: number // where body starts (after header + extra)
}

export function parseHeader(buf: Buffer): ParsedHeader {
	const flags      = buf[0]
	const seq        = buf.readUInt32BE(1)
	const extraBytes = buf[5]
	return {
		flags,
		reliable:  (flags & FLAG_RELIABLE)   !== 0,
		hasAcks:   (flags & FLAG_HAS_ACKS)   !== 0,
		zeroCoded: (flags & FLAG_ZERO_CODED) !== 0,
		seq,
		extraBytes,
		bodyOffset: 6 + extraBytes,
	}
}
