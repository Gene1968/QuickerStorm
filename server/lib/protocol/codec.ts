// server/lib/protocol/codec.ts — generic template-driven LLUDP encode/decode.
// Walks the message dictionary (template.ts) + field primitives (fields.ts). Replaces
// the per-message hand-written byte math. Opaque packed-binary Variable fields (ObjectUpdate
// pos/rot blob, TextureEntry, Compressed/Terse Data) come back as raw Buffers — their
// CONTENTS are parsed by the blob sub-parsers under ./blobs/, which the dispatcher calls.
import { loadTemplate } from './template.ts'
import { readField, writeField, sizeOfField } from './fields.ts'
import { buildHeader, parseHeader, encodeZeroCoded, decodeZeroCoded } from './wire.ts'
import type { MsgDef } from './types.ts'

const proto = loadTemplate()

// NOTE: zero-coding is per-packet OPT-IN, not template-mandated. The template's `zerocoded`
// flag marks ELIGIBILITY; existing hand-written encoders deliberately send un-zero-coded bodies.
// `encode` zero-codes ONLY when opts.zeroCoded is true, preserving byte-equivalence with them.
// DECODE is unaffected — it reverses zero-coding based on the HEADER flag, never the template.
export interface EncodeOpts { seq: number; reliable?: boolean; hasAcks?: boolean; zeroCoded?: boolean }

type BlockInput = Record<string, unknown>
type BlocksInput = Record<string, BlockInput | BlockInput[]>

function instances(input: BlockInput | BlockInput[] | undefined): BlockInput[] {
	if (input == null) return []
	return Array.isArray(input) ? input : [input]
}

export function encode(name: string, blocks: BlocksInput, opts: EncodeOpts): Buffer {
	const def = proto.byName.get(name)
	if (!def) throw new Error(`encode: unknown message '${name}'`)

	// Pass 1: size the body (after the message-id prefix).
	let bodyLen = 0
	for (const block of def.blocks) {
		const insts = instances(blocks[block.name])
		if (block.quantity === 'Variable') bodyLen += 1 // U8 count prefix
		for (const inst of insts) for (const f of block.fields) bodyLen += sizeOfField(f, inst[f.name])
	}

	// Pass 2: write the body.
	const body = Buffer.alloc(bodyLen)
	let off = 0
	for (const block of def.blocks) {
		const insts = instances(blocks[block.name])
		if (block.quantity === 'Variable') { body.writeUInt8(insts.length & 0xFF, off); off += 1 }
		for (const inst of insts) for (const f of block.fields) off = writeField(body, off, f, inst[f.name])
	}

	// Zero-coding (opt-in): per LLUDP the message id IS part of the zero-coded body, so we code
	// id+fields as one unit. (decode reverses this by expanding before reading the id.)
	const zc = !!opts.zeroCoded
	const payload = zc
		? encodeZeroCoded(Buffer.concat([def.idBytes, body]))
		: Buffer.concat([def.idBytes, body])
	const hdr = buildHeader({ seq: opts.seq, reliable: !!opts.reliable, hasAcks: !!opts.hasAcks, zeroCoded: zc })
	return Buffer.concat([hdr, payload])
}

export interface DecodedMsg {
	name?: string
	unknown?: boolean
	freqId?: string
	blocks: Record<string, Array<Record<string, unknown>>>
}

// Identify the message from its raw (never-zero-coded) id-prefix bytes.
function lookup(body: Buffer): { def?: MsgDef; freqId: string; idLen: number } {
	const b0 = body[0]
	if (b0 !== 0xFF) return { def: proto.byFreqId.get(`High:${b0}`), freqId: `High:${b0}`, idLen: 1 }
	const b1 = body[1]
	if (b1 !== 0xFF) return { def: proto.byFreqId.get(`Medium:${b1}`), freqId: `Medium:${b1}`, idLen: 2 }
	const b2 = body[2]
	if (b2 !== 0xFF) {
		const id = body.readUInt16BE(2)
		return { def: proto.byFreqId.get(`Low:${id}`), freqId: `Low:${id}`, idLen: 4 }
	}
	const hex = `Fixed:0x${body.readUInt32BE(0).toString(16).toUpperCase()}`
	return { def: proto.byFreqId.get(hex), freqId: hex, idLen: 4 }
}

// Cheap message identification from the id-prefix bytes alone — no zero-decode, no field walk.
// Use this to route in a dispatcher that has already expanded/ack-stripped the buffer.
export function messageName(buf: Buffer): string | undefined {
	const hdr = parseHeader(buf)
	return lookup(buf.slice(hdr.bodyOffset)).def?.name
}

export interface DecodeOpts {
	// Set when the caller has ALREADY zero-decoded the body (e.g. the LLUDP dispatcher expands
	// the body before parsing). Prevents a double zero-decode that would corrupt field data.
	alreadyExpanded?: boolean
}

export function decode(buf: Buffer, opts?: DecodeOpts): DecodedMsg {
	const hdr = parseHeader(buf)
	// Expand the whole body (id + fields) first when zero-coded, since the message id is part of
	// the zero-coded unit — unless the caller already expanded it (e.g. the LLUDP dispatcher).
	const body = (hdr.zeroCoded && !opts?.alreadyExpanded)
		? decodeZeroCoded(buf.slice(hdr.bodyOffset))
		: buf.slice(hdr.bodyOffset)
	const { def, freqId, idLen } = lookup(body)
	if (!def) return { unknown: true, freqId, blocks: {} }
	const fieldData = body.slice(idLen)

	const out: DecodedMsg = { name: def.name, freqId, blocks: {} }
	let off = 0
	for (const block of def.blocks) {
		let n = 1
		if (block.quantity === 'Variable') { n = fieldData.readUInt8(off); off += 1 }
		else if (block.quantity === 'Multiple') n = block.count ?? 1
		const arr: Array<Record<string, unknown>> = []
		for (let inst = 0; inst < n; inst++) {
			const rec: Record<string, unknown> = {}
			for (const f of block.fields) {
				if (off >= fieldData.length) break // best-effort on truncation
				const { value, next } = readField(fieldData, off, f)
				rec[f.name] = value
				off = next
			}
			arr.push(rec)
		}
		out.blocks[block.name] = arr
	}
	return out
}
