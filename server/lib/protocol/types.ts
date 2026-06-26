// server/lib/protocol/types.ts — shape of a parsed message_template.msg entry.
export type FieldType =
	| 'U8' | 'U16' | 'U32' | 'U64'
	| 'S8' | 'S16' | 'S32' | 'S64'
	| 'F32' | 'F64'
	| 'LLVector3' | 'LLVector3d' | 'LLVector4' | 'LLQuaternion'
	| 'LLUUID' | 'BOOL' | 'IPADDR' | 'IPPORT'
	| 'Fixed' | 'Variable'

export type Frequency = 'High' | 'Medium' | 'Low' | 'Fixed'
export type BlockQuantity = 'Single' | 'Multiple' | 'Variable'

export interface FieldDef {
	name: string
	type: FieldType
	size?: number   // Fixed N → byte count; Variable N → 1 or 2 (length-prefix width)
}
export interface BlockDef {
	name: string
	quantity: BlockQuantity
	count?: number  // Multiple N → repetition count
	fields: FieldDef[]
}
export interface MsgDef {
	name: string
	frequency: Frequency
	id: number          // message number within its frequency
	idBytes: Buffer     // the 1/2/4-byte wire prefix
	zerocoded: boolean
	trusted: boolean
	blocks: BlockDef[]
}
