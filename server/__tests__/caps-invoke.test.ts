// server/__tests__/caps-invoke.test.ts
import { describe, it, expect } from 'bun:test'
import { runCap } from '../lib/caps/invoke'
import { encodeLLSD, llsd } from '../lib/caps/llsdEncode'

// Minimal Response-like stub for the injected fetchFn.
const resp = (status: number, body: string) =>
	({ ok: status >= 200 && status < 300, status, text: async () => body } as Response)

describe('runCap', () => {
	it('encodes params via encodeLLSD and decodes the LLSD response (identity)', async () => {
		let sentBody = ''
		const fetchFn = (async (_url: string, init: any) => {
			sentBody = init.body
			return resp(200, '<llsd><map><key>ok</key><integer>1</integer></map></llsd>')
		}) as unknown as typeof fetch
		const out = await runCap('https://sim/cap/x', undefined, { hello: llsd.uuid('a') }, 'POST', fetchFn)
		expect(sentBody).toBe(encodeLLSD({ hello: llsd.uuid('a') }))
		expect(out).toEqual({ ok: true, result: { ok: 1 } })
	})

	it('applies registry request/response shapers', async () => {
		const fetchFn = (async () => resp(200, '<llsd><map><key>n</key><integer>5</integer></map></llsd>')) as unknown as typeof fetch
		const def = { name: 'X', request: (p: any) => ({ wrapped: p }), response: (l: any) => l.n * 2 }
		const out = await runCap('https://sim/cap/x', def, 7, 'POST', fetchFn)
		expect(out).toEqual({ ok: true, result: 10 })
	})

	it('reports http errors with status', async () => {
		const fetchFn = (async () => resp(500, 'boom')) as unknown as typeof fetch
		const out = await runCap('https://sim/cap/x', undefined, {}, 'POST', fetchFn)
		expect(out).toEqual({ ok: false, error: 'http_500', status: 500 })
	})

	it('omits the body on GET', async () => {
		let init: any
		const fetchFn = (async (_u: string, i: any) => { init = i; return resp(200, '<llsd><undef/></llsd>') }) as unknown as typeof fetch
		await runCap('https://sim/cap/x', undefined, { a: 1 }, 'GET', fetchFn)
		expect(init.method).toBe('GET')
		expect(init.body).toBeUndefined()
	})
})
