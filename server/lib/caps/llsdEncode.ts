// server/lib/caps/llsdEncode.ts — JS value → LLSD-XML document. The one place LLSD
// serialization lives (pairs with parseLLSD in ../llsd for the full round-trip).
// JS can't distinguish LLSD integer/real/uuid/uri/date/binary, so typed wrappers (llsd.*)
// disambiguate; plain numbers default to integer when Number.isInteger, else real.

export type LLSDTyped =
	| { __llsd: 'int';    v: number }
	| { __llsd: 'real';   v: number }
	| { __llsd: 'uuid';   v: string }
	| { __llsd: 'uri';    v: string }
	| { __llsd: 'date';   v: string }
	| { __llsd: 'bool';   v: boolean }
	| { __llsd: 'binary'; v: Buffer }

export const llsd = {
	int:    (v: number):  LLSDTyped => ({ __llsd: 'int', v }),
	real:   (v: number):  LLSDTyped => ({ __llsd: 'real', v }),
	uuid:   (v: string):  LLSDTyped => ({ __llsd: 'uuid', v }),
	uri:    (v: string):  LLSDTyped => ({ __llsd: 'uri', v }),
	date:   (v: string):  LLSDTyped => ({ __llsd: 'date', v }),
	bool:   (v: boolean): LLSDTyped => ({ __llsd: 'bool', v }),
	binary: (v: Buffer):  LLSDTyped => ({ __llsd: 'binary', v }),
}

function esc(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function encodeTyped(t: LLSDTyped): string {
	switch (t.__llsd) {
		case 'int':    return `<integer>${Math.trunc(t.v)}</integer>`
		case 'real':   return `<real>${t.v}</real>`
		case 'uuid':   return `<uuid>${esc(t.v)}</uuid>`
		case 'uri':    return `<uri>${esc(t.v)}</uri>`
		case 'date':   return `<date>${esc(t.v)}</date>`
		case 'bool':   return `<boolean>${t.v ? 'true' : 'false'}</boolean>`
		case 'binary': return `<binary encoding="base64">${t.v.toString('base64')}</binary>`
	}
}

function encodeValue(v: any): string {
	if (v === null || v === undefined) return '<undef/>'
	if (typeof v === 'boolean') return `<boolean>${v ? 'true' : 'false'}</boolean>`
	if (typeof v === 'number')  return Number.isInteger(v) ? `<integer>${v}</integer>` : `<real>${v}</real>`
	if (typeof v === 'string')  return `<string>${esc(v)}</string>`
	if (Buffer.isBuffer(v))     return `<binary encoding="base64">${v.toString('base64')}</binary>`
	if (Array.isArray(v))       return `<array>${v.map(encodeValue).join('')}</array>`
	if (typeof v === 'object') {
		if ('__llsd' in v) return encodeTyped(v as LLSDTyped)
		return `<map>${Object.entries(v).map(([k, val]) => `<key>${esc(k)}</key>${encodeValue(val)}`).join('')}</map>`
	}
	return '<undef/>'
}

/** Serialize a JS value to a full LLSD-XML document. */
export function encodeLLSD(value: any): string {
	return `<?xml version="1.0" encoding="UTF-8"?>\n<llsd>${encodeValue(value)}</llsd>`
}
