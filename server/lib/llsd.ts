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
