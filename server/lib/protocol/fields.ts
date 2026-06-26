// server/lib/protocol/fields.ts — read/write one LLUDP wire field.
// This is the ONLY place byte math lives. Conventions verified against the existing
// hand-written encoders in ../lludp-codec.ts: all integers little-endian, BOOL = 1 byte,
// LLQuaternion = 3 floats (w derived), Variable length-prefix is LE.
import type { FieldDef } from './types.ts'
import { uuidToBytes, bytesToUuid } from '../lludp-codec.ts'

const ZERO_UUID = '00000000-0000-0000-0000-000000000000'

export function sizeOfField(def: FieldDef, value: unknown): number {
	switch (def.type) {
		case 'U8': case 'S8': case 'BOOL': return 1
		case 'U16': case 'S16': case 'IPPORT': return 2
		case 'U32': case 'S32': case 'F32': case 'IPADDR': return 4
		case 'U64': case 'S64': case 'F64': return 8
		case 'LLVector3': return 12
		case 'LLVector3d': return 24
		case 'LLVector4': return 16
		case 'LLQuaternion': return 12
		case 'LLUUID': return 16
		case 'Fixed': return def.size!
		case 'Variable': return (def.size ?? 1) + (value as Buffer).length
	}
}

export function writeField(buf: Buffer, off: number, def: FieldDef, value: unknown): number {
	switch (def.type) {
		case 'U8':  buf.writeUInt8((value as number) & 0xFF, off); return off + 1
		case 'S8':  buf.writeInt8(value as number, off); return off + 1
		case 'BOOL': buf.writeUInt8(value ? 1 : 0, off); return off + 1
		case 'U16': buf.writeUInt16LE((value as number) & 0xFFFF, off); return off + 2
		case 'S16': buf.writeInt16LE(value as number, off); return off + 2
		case 'IPPORT': buf.writeUInt16LE((value as number) & 0xFFFF, off); return off + 2
		case 'U32': buf.writeUInt32LE((value as number) >>> 0, off); return off + 4
		case 'S32': buf.writeInt32LE(value as number, off); return off + 4
		case 'F32': buf.writeFloatLE(value as number, off); return off + 4
		case 'IPADDR': (value as Buffer).copy(buf, off, 0, 4); return off + 4
		case 'U64': buf.writeBigUInt64LE(BigInt(value as bigint | number), off); return off + 8
		case 'S64': buf.writeBigInt64LE(BigInt(value as bigint | number), off); return off + 8
		case 'F64': buf.writeDoubleLE(value as number, off); return off + 8
		case 'LLVector3': { const v = value as number[]; for (let k = 0; k < 3; k++) buf.writeFloatLE(v[k], off + k * 4); return off + 12 }
		case 'LLVector3d': { const v = value as number[]; for (let k = 0; k < 3; k++) buf.writeDoubleLE(v[k], off + k * 8); return off + 24 }
		case 'LLVector4': { const v = value as number[]; for (let k = 0; k < 4; k++) buf.writeFloatLE(v[k], off + k * 4); return off + 16 }
		case 'LLQuaternion': { const v = value as number[]; for (let k = 0; k < 3; k++) buf.writeFloatLE(v[k], off + k * 4); return off + 12 }
		case 'LLUUID': uuidToBytes((value as string) || ZERO_UUID).copy(buf, off); return off + 16
		case 'Fixed': (value as Buffer).copy(buf, off, 0, def.size!); return off + def.size!
		case 'Variable': {
			const payload = value as Buffer
			const w = def.size ?? 1
			if (w === 1) buf.writeUInt8(payload.length & 0xFF, off)
			else buf.writeUInt16LE(payload.length & 0xFFFF, off)
			payload.copy(buf, off + w)
			return off + w + payload.length
		}
	}
}

export function readField(buf: Buffer, off: number, def: FieldDef): { value: unknown; next: number } {
	switch (def.type) {
		case 'U8':  return { value: buf.readUInt8(off), next: off + 1 }
		case 'S8':  return { value: buf.readInt8(off), next: off + 1 }
		case 'BOOL': return { value: buf.readUInt8(off) !== 0, next: off + 1 }
		case 'U16': return { value: buf.readUInt16LE(off), next: off + 2 }
		case 'S16': return { value: buf.readInt16LE(off), next: off + 2 }
		case 'IPPORT': return { value: buf.readUInt16LE(off), next: off + 2 }
		case 'U32': return { value: buf.readUInt32LE(off), next: off + 4 }
		case 'S32': return { value: buf.readInt32LE(off), next: off + 4 }
		case 'F32': return { value: buf.readFloatLE(off), next: off + 4 }
		case 'IPADDR': return { value: buf.slice(off, off + 4), next: off + 4 }
		case 'U64': return { value: buf.readBigUInt64LE(off), next: off + 8 }
		case 'S64': return { value: buf.readBigInt64LE(off), next: off + 8 }
		case 'F64': return { value: buf.readDoubleLE(off), next: off + 8 }
		case 'LLVector3': return { value: [buf.readFloatLE(off), buf.readFloatLE(off + 4), buf.readFloatLE(off + 8)], next: off + 12 }
		case 'LLVector3d': return { value: [buf.readDoubleLE(off), buf.readDoubleLE(off + 8), buf.readDoubleLE(off + 16)], next: off + 24 }
		case 'LLVector4': return { value: [buf.readFloatLE(off), buf.readFloatLE(off + 4), buf.readFloatLE(off + 8), buf.readFloatLE(off + 12)], next: off + 16 }
		case 'LLQuaternion': return { value: [buf.readFloatLE(off), buf.readFloatLE(off + 4), buf.readFloatLE(off + 8)], next: off + 12 }
		case 'LLUUID': return { value: bytesToUuid(buf, off), next: off + 16 }
		case 'Fixed': return { value: buf.slice(off, off + def.size!), next: off + def.size! }
		case 'Variable': {
			const w = def.size ?? 1
			const len = w === 1 ? buf.readUInt8(off) : buf.readUInt16LE(off)
			return { value: buf.slice(off + w, off + w + len), next: off + w + len }
		}
	}
}
