// server/lib/llsd.ts — minimal LLSD-XML parser for HTTP capability responses.
// WHY: SL/OpenSim caps (FetchInventoryDescendents2, seed cap, GetTexture metadata, …) speak
// LLSD-XML, not XML-RPC. The XML-RPC regex parser in xmlrpc.ts can't model nested map/array.
// This is a small recursive-descent parser over a tag/text token stream. Parser-only for now —
// request bodies are short enough to hand-build as strings.
//
// Supported value tags: map, array, string, key, integer, real, boolean, uuid, uri, date,
// binary (kept as base64 string), undef. Unknown leaf tags fall back to their text content.

export type LLSDValue =
	| null
	| boolean
	| number
	| string
	| LLSDValue[]
	| { [k: string]: LLSDValue }

interface Tok {
	tag?: string        // tag name (lowercased) when this token is an element tag
	closing?: boolean   // </tag>
	selfClose?: boolean // <tag/>
	text?: string       // raw text run between tags
}

function decodeEntities(s: string): string {
	return s
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, '&')
}

function tokenize(xml: string): Tok[] {
	const toks: Tok[] = []
	const re = /<([^>]+)>|([^<]+)/g
	let m: RegExpExecArray | null
	while ((m = re.exec(xml)) !== null) {
		if (m[1] !== undefined) {
			let t = m[1].trim()
			if (t.startsWith('?') || t.startsWith('!')) continue   // <?xml?>, comments, doctype
			const selfClose = t.endsWith('/')
			if (selfClose) t = t.slice(0, -1).trim()
			const closing = t.startsWith('/')
			const name = (closing ? t.slice(1) : t).trim().split(/\s/)[0].toLowerCase()
			toks.push({ tag: name, closing, selfClose })
		} else {
			toks.push({ text: m[2] })
		}
	}
	return toks
}

function emptyFor(tag: string): LLSDValue {
	switch (tag) {
		case 'map':     return {}
		case 'array':   return []
		case 'boolean': return false
		case 'integer': return 0
		case 'real':    return 0
		case 'undef':   return null
		default:        return ''
	}
}

function coerce(tag: string, raw: string): LLSDValue {
	const text = decodeEntities(raw)
	switch (tag) {
		case 'integer': { const n = parseInt(text.trim(), 10); return Number.isNaN(n) ? 0 : n }
		case 'real':    { const n = parseFloat(text.trim());   return Number.isNaN(n) ? 0 : n }
		case 'boolean': { const t = text.trim().toLowerCase(); return t === 'true' || t === '1' }
		case 'undef':   return null
		// string / uuid / uri / date / binary / key → keep text verbatim (trimmed for id-ish types)
		case 'uuid':
		case 'uri':
		case 'date':    return text.trim()
		default:        return text
	}
}

/** Parse an LLSD-XML document into a plain JS value. Returns null on empty/unparseable input. */
export function parseLLSD(xml: string): LLSDValue {
	const toks = tokenize(xml)
	let p = 0

	const skipBlankText = () => {
		while (p < toks.length && toks[p].text !== undefined && toks[p].text!.trim() === '') p++
	}

	function parseValue(): LLSDValue {
		skipBlankText()
		const tok = toks[p]
		if (!tok || tok.text !== undefined || tok.closing) return null
		const tag = tok.tag!
		if (tok.selfClose) { p++; return emptyFor(tag) }
		p++ // consume opening tag
		if (tag === 'map')   return parseMap()
		if (tag === 'array') return parseArray()
		if (tag === 'llsd') { const v = parseValue(); skipBlankText(); if (toks[p]?.closing) p++; return v }
		// leaf: accumulate text until the closing tag
		let text = ''
		while (p < toks.length && toks[p].text !== undefined) { text += toks[p].text; p++ }
		if (p < toks.length && toks[p].closing) p++
		return coerce(tag, text)
	}

	function parseMap(): { [k: string]: LLSDValue } {
		const obj: { [k: string]: LLSDValue } = {}
		while (p < toks.length) {
			skipBlankText()
			const tok = toks[p]
			if (!tok) break
			if (tok.closing && tok.tag === 'map') { p++; break }
			if (tok.tag === 'key' && !tok.closing) {
				p++ // <key>
				let key = ''
				while (p < toks.length && toks[p].text !== undefined) { key += toks[p].text; p++ }
				if (p < toks.length && toks[p].closing && toks[p].tag === 'key') p++ // </key>
				obj[decodeEntities(key).trim()] = parseValue()
			} else {
				p++ // skip stray token
			}
		}
		return obj
	}

	function parseArray(): LLSDValue[] {
		const arr: LLSDValue[] = []
		while (p < toks.length) {
			skipBlankText()
			const tok = toks[p]
			if (!tok) break
			if (tok.closing && tok.tag === 'array') { p++; break }
			arr.push(parseValue())
		}
		return arr
	}

	skipBlankText()
	if (p >= toks.length) return null
	return parseValue()
}

/** Coerce an LLSD value to a number (handles missing/string). */
export function llsdNum(v: LLSDValue): number {
	if (typeof v === 'number') return v
	if (typeof v === 'string') { const n = parseFloat(v); return Number.isNaN(n) ? 0 : n }
	return 0
}

/** Coerce an LLSD value to a string. */
export function llsdStr(v: LLSDValue): string {
	return v == null ? '' : String(v)
}

// ── LLSD Binary ────────────────────────────────────────────────────────────
// WHY: mesh asset headers (GetMesh/ViewerAsset) and a few caps speak LLSD *Binary*, not XML.
// Format (llsdserialize.cpp, network/big-endian throughout): a 1-byte type marker followed by the
// payload. '!' undef, '1'/'0' bool, 'i' int32, 'r'/'d' float64, 'u' 16-byte UUID, 's'/'l' u32-len
// string, 'b' u32-len binary, '[' u32-count array ']', '{' u32-count map '}' where each map entry
// is 'k'+u32-len key then a value. Binary leaves return a Buffer (raw bytes are more useful than
// base64 here). Returns { value, end } so callers (mesh: absolute offset = headerSize) know how
// many bytes the document consumed.

function uuidHex(buf: Buffer, p: number): string {
	const h = buf.toString('hex', p, p + 16)
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

function readBin(buf: Buffer, p: number): { value: any; end: number } {
	const marker = buf[p]; p++
	switch (marker) {
		case 0x21: return { value: null, end: p }                                         // '!'
		case 0x31: return { value: true, end: p }                                         // '1'
		case 0x30: return { value: false, end: p }                                        // '0'
		case 0x69: return { value: buf.readInt32BE(p), end: p + 4 }                        // 'i'
		case 0x72:                                                                        // 'r'
		case 0x64: return { value: buf.readDoubleBE(p), end: p + 8 }                       // 'd' (date→sec)
		case 0x75: return { value: uuidHex(buf, p), end: p + 16 }                          // 'u'
		case 0x73:                                                                        // 's'
		case 0x6c: {                                                                      // 'l'
			const len = buf.readUInt32BE(p); p += 4
			return { value: buf.toString('utf8', p, p + len), end: p + len }
		}
		case 0x62: {                                                                      // 'b'
			const len = buf.readUInt32BE(p); p += 4
			return { value: Buffer.from(buf.subarray(p, p + len)), end: p + len }
		}
		case 0x5b: {                                                                      // '['
			const count = buf.readUInt32BE(p); p += 4
			const arr: any[] = []
			for (let i = 0; i < count; i++) { const r = readBin(buf, p); arr.push(r.value); p = r.end }
			if (buf[p] === 0x5d) p++                                                       // ']'
			return { value: arr, end: p }
		}
		case 0x7b: {                                                                      // '{'
			const count = buf.readUInt32BE(p); p += 4
			const obj: Record<string, any> = {}
			for (let i = 0; i < count; i++) {
				if (buf[p] === 0x6b) p++                                                   // 'k'
				const klen = buf.readUInt32BE(p); p += 4
				const key = buf.toString('utf8', p, p + klen); p += klen
				const r = readBin(buf, p); obj[key] = r.value; p = r.end
			}
			if (buf[p] === 0x7d) p++                                                       // '}'
			return { value: obj, end: p }
		}
		default: return { value: null, end: p }
	}
}

/**
 * Parse an LLSD Binary document. Skips the optional `<? LLSD/Binary ?>\n` header line.
 * Returns the decoded value plus `end` = byte index just past the document.
 */
export function parseLLSDBinary(buf: Buffer, start = 0): { value: any; end: number } {
	let p = start
	if (buf[p] === 0x3c && buf[p + 1] === 0x3f) {           // '<?' → skip header line
		const nl = buf.indexOf(0x0a, p)
		if (nl >= 0) p = nl + 1
	}
	return readBin(buf, p)
}
