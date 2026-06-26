// server/lib/protocol/template.ts — parse message_template.msg into a message dictionary.
// Reference: libopenmetaverse ProtocolManager / indra LLTemplateMessageReader.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { MsgDef, BlockDef, FieldDef, Frequency, FieldType, BlockQuantity } from './types.ts'

export interface Protocol {
	byName: Map<string, MsgDef>
	byFreqId: Map<string, MsgDef> // key `${freq}:${id}` — Fixed id kept as hex string
}

// WHY: the wire prefix is derived from frequency + number, NOT hand-coded per message.
// This is the single place that mapping lives — getting it wrong here is the SetAlwaysRun
// Low-88-vs-21 class of bug, now impossible to mis-type per message.
function idBytesFor(freq: Frequency, id: number): Buffer {
	switch (freq) {
		case 'High':   return Buffer.from([id & 0xFF])
		case 'Medium': return Buffer.from([0xFF, id & 0xFF])
		case 'Low':    return Buffer.from([0xFF, 0xFF, (id >> 8) & 0xFF, id & 0xFF])
		case 'Fixed': {
			const b = Buffer.alloc(4)
			b.writeUInt32BE(id >>> 0, 0)
			return b
		}
	}
}

// Strip // comments, then tokenize into a flat stream of words and braces.
function tokenize(src: string): string[] {
	const noComments = src.replace(/\/\/[^\n]*/g, ' ')
	return noComments.match(/\{|\}|[^\s{}]+/g) ?? []
}

export function parseTemplate(src: string): Protocol {
	const toks = tokenize(src)
	let i = 0
	const byName = new Map<string, MsgDef>()
	const byFreqId = new Map<string, MsgDef>()

	const expect = (t: string) => {
		if (toks[i] !== t) throw new Error(`template parse: expected '${t}' at token ${i}, got '${toks[i]}'`)
		i++
	}

	while (i < toks.length) {
		// Skip anything that isn't the start of a message block (e.g. the leading "version 2.0").
		if (toks[i] !== '{') { i++; continue }
		// Message header: { Name Freq Id Trust Encoding
		expect('{')
		const name = toks[i++]
		const frequency = toks[i++] as Frequency
		const idTok = toks[i++]
		const id = idTok.startsWith('0x') ? parseInt(idTok, 16) : parseInt(idTok, 10)
		i++ // Trust (Trusted | NotTrusted) — not needed for codec
		const encoding = toks[i++] // Zerocoded | Unencoded
		// Optional trailing deprecation flag(s): NotDeprecated | Deprecated | UDPDeprecated |
		// UDPBlackListed. Consume any header tokens until the first block opener (or message end).
		while (toks[i] !== '{' && toks[i] !== '}') i++
		const blocks: BlockDef[] = []
		while (toks[i] === '{') {
			expect('{')
			const blockName = toks[i++]
			const quantity = toks[i++] as BlockQuantity
			let count: number | undefined
			// Multiple blocks carry a fixed repetition count; Single/Variable do not.
			if (quantity === 'Multiple') count = parseInt(toks[i++], 10)
			const fields: FieldDef[] = []
			while (toks[i] === '{') {
				expect('{')
				const fName = toks[i++]
				const fType = toks[i++] as FieldType
				let size: number | undefined
				// Fixed N → byte count; Variable N → length-prefix width (1 or 2).
				if (fType === 'Fixed' || fType === 'Variable') size = parseInt(toks[i++], 10)
				expect('}')
				fields.push({ name: fName, type: fType, size })
			}
			expect('}')
			blocks.push({ name: blockName, quantity, count, fields })
		}
		expect('}')
		const def: MsgDef = {
			name,
			frequency,
			id,
			idBytes: idBytesFor(frequency, id),
			zerocoded: encoding === 'Zerocoded',
			trusted: true,
			blocks,
		}
		byName.set(name, def)
		const fid = frequency === 'Fixed'
			? `Fixed:0x${(id >>> 0).toString(16).toUpperCase()}`
			: `${frequency}:${id}`
		byFreqId.set(fid, def)
	}
	return { byName, byFreqId }
}

let cached: Protocol | null = null
export function loadTemplate(): Protocol {
	if (cached) return cached
	const here = dirname(fileURLToPath(import.meta.url))
	const src = readFileSync(join(here, 'message_template.msg'), 'utf8')
	cached = parseTemplate(src)
	return cached
}
