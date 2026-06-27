# Caps Framework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a server-side, call-by-name cap (HTTP capability) framework so adding a standard LLSD cap becomes pure client work (no Bun restart), mirroring the template-driven LLUDP codec.

**Architecture:** A JSON→LLSD-XML encoder (keystone) + a cap registry (data) + a generic `runCap`/`invokeCap` round-trip keyed by cap *name*. One generic `C.CAP_CALL`/`S.CAP_RESULT` protocol pair and a client `useCaps` composable with promise correlation. Special transports (binary asset caps, zlib/binary materials) stay in dedicated handlers, declared in the registry. The EventQueue inbound `switch` becomes a data-driven registry that forwards unregistered events generically. Migrate the inventory consumer's LLSD build/parse onto the framework.

**Tech Stack:** Bun (server, `bun:test`), TypeScript, Vue 3 (`<script setup>`), the existing `server/lib/llsd.ts` parser, `shared/protocol.js` envelope.

---

## File Structure

- `server/lib/caps/llsdEncode.ts` — **new.** JSON→LLSD-XML serializer + typed wrappers. The one place LLSD serialization lives.
- `server/lib/caps/registry.ts` — **new.** `CapDef` type, register/get, `DEDICATED_CAPS` set.
- `server/lib/caps/invoke.ts` — **new.** Pure `runCap(url, def, params, method, fetchFn)` + session-bound `invokeCap(circuitId, id, cap, params, method)`.
- `server/lib/caps/inventoryCap.ts` — **new.** Inventory request-builder + response-decoder (pure), registered as a `CapDef`.
- `server/__tests__/caps-llsdEncode.test.ts` / `caps-invoke.test.ts` / `caps-inventory.test.ts` — **new.** Offline tests.
- `shared/protocol.js` — **modify.** Add `C.CAP_CALL`, `S.CAP_RESULT`, `S.EQ_EVENT`.
- `server/index.ts` — **modify.** Dispatch `C.CAP_CALL` → `invokeCap`.
- `server/lib/eventQueue.ts` — **modify.** Replace `dispatchEvent`'s `switch` with an `eqRegistry` map + generic forward.
- `server/handlers/inventory.ts` — **modify.** Build/parse via the framework (`encodeLLSD` + `runCap` + the inventoryCap def); keep per-folder `S.INV_FOLDER` fanout and fallback-cap-name logic.
- `server/handlers/login.ts` — **modify.** Broaden `REQUESTED_CAPS`.
- `src/composables/useCaps.js` — **new.** Singleton `cap(name).post/get` → Promise; consumes `S.CAP_RESULT`.

---

## Task 1: JSON→LLSD-XML encoder (the keystone)

**Files:**
- Create: `server/lib/caps/llsdEncode.ts`
- Test: `server/__tests__/caps-llsdEncode.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// server/__tests__/caps-llsdEncode.test.ts
import { describe, it, expect } from 'bun:test'
import { encodeLLSD, llsd } from '../lib/caps/llsdEncode'
import { parseLLSD } from '../lib/llsd'

describe('encodeLLSD', () => {
	it('wraps output in an llsd envelope', () => {
		expect(encodeLLSD(null)).toBe('<?xml version="1.0" encoding="UTF-8"?>\n<llsd><undef/></llsd>')
	})

	it('round-trips plain types through parseLLSD', () => {
		const v = { a: 1, b: 'hi', c: true, d: [1, 2, 3], e: null, f: 1.5 }
		expect(parseLLSD(encodeLLSD(v))).toEqual(v)
	})

	it('defaults integer vs real by Number.isInteger', () => {
		expect(encodeLLSD(3)).toContain('<integer>3</integer>')
		expect(encodeLLSD(3.5)).toContain('<real>3.5</real>')
	})

	it('emits typed wrappers as their LLSD element', () => {
		expect(encodeLLSD(llsd.uuid('11111111-1111-1111-1111-111111111111')))
			.toContain('<uuid>11111111-1111-1111-1111-111111111111</uuid>')
		expect(encodeLLSD(llsd.real(2))).toContain('<real>2</real>')
		expect(encodeLLSD(llsd.int(2.9))).toContain('<integer>2</integer>')
		expect(encodeLLSD(llsd.binary(Buffer.from('hi')))).toContain('<binary encoding="base64">aGk=</binary>')
	})

	it('escapes entity characters in strings and keys', () => {
		expect(encodeLLSD({ 'a&b': '<x>' })).toContain('<key>a&amp;b</key><string>&lt;x&gt;</string>')
	})

	it('golden: FetchInventoryDescendents2 request body', () => {
		const body = encodeLLSD({
			folders: [{
				folder_id: llsd.uuid('22222222-2222-2222-2222-222222222222'),
				owner_id: llsd.uuid('33333333-3333-3333-3333-333333333333'),
				fetch_folders: true, fetch_items: true, sort_order: 0,
			}],
		})
		expect(body).toBe(
			'<?xml version="1.0" encoding="UTF-8"?>\n<llsd><map><key>folders</key><array><map>' +
			'<key>folder_id</key><uuid>22222222-2222-2222-2222-222222222222</uuid>' +
			'<key>owner_id</key><uuid>33333333-3333-3333-3333-333333333333</uuid>' +
			'<key>fetch_folders</key><boolean>true</boolean>' +
			'<key>fetch_items</key><boolean>true</boolean>' +
			'<key>sort_order</key><integer>0</integer>' +
			'</map></array></map></llsd>')
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test server/__tests__/caps-llsdEncode.test.ts`
Expected: FAIL — `Cannot find module '../lib/caps/llsdEncode'`.

- [ ] **Step 3: Write minimal implementation**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test server/__tests__/caps-llsdEncode.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add server/lib/caps/llsdEncode.ts server/__tests__/caps-llsdEncode.test.ts
git commit -m "feat(caps): JSON to LLSD-XML encoder"
```

---

## Task 2: Cap registry

**Files:**
- Create: `server/lib/caps/registry.ts`

No standalone test (pure data structure; exercised by Task 3 and Task 7 tests).

- [ ] **Step 1: Write the implementation**

```ts
// server/lib/caps/registry.ts — caps as data. A cap NOT registered here is still callable by
// name through the generic path (identity request, decoded-LLSD response) IF the grid offered it.
// The registry holds only caps that need server-side shaping. DEDICATED_CAPS lists caps owned by
// bespoke handlers (binary/zlib transports) — the generic path refuses those.
import type { LLSDValue } from '../llsd'

export interface CapDef {
	name: string
	method?: 'POST' | 'GET'
	request?:  (params: any) => any         // JS value → request payload (encodeLLSD'd by runCap)
	response?: (llsd: LLSDValue) => any      // decoded LLSD → typed JS for the client
}

const REGISTRY = new Map<string, CapDef>()

export function registerCap(def: CapDef): void { REGISTRY.set(def.name, def) }
export function getCapDef(name: string): CapDef | undefined { return REGISTRY.get(name) }

// Caps served by dedicated handlers, NOT the generic LLSD round-trip:
//   ViewerAsset/GetTexture/GetMesh/GetMesh2 — binary + HTTP Range asset fetch (handlers/assets.ts)
//   RenderMaterials/ModifyMaterialParams   — zlib-wrapped LLSD *binary* (handlers/materials.ts)
export const DEDICATED_CAPS = new Set<string>([
	'ViewerAsset', 'GetTexture', 'GetMesh', 'GetMesh2',
	'RenderMaterials', 'ModifyMaterialParams',
])
```

- [ ] **Step 2: Verify it compiles**

Run: `bun build server/lib/caps/registry.ts --target=bun > /dev/null && echo OK`
Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add server/lib/caps/registry.ts
git commit -m "feat(caps): cap registry + dedicated-cap set"
```

---

## Task 3: Generic invoke (runCap pure core + invokeCap)

**Files:**
- Create: `server/lib/caps/invoke.ts`
- Test: `server/__tests__/caps-invoke.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test server/__tests__/caps-invoke.test.ts`
Expected: FAIL — `Cannot find module '../lib/caps/invoke'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// server/lib/caps/invoke.ts — generic cap call. runCap is pure (injectable fetch) and unit-tested;
// invokeCap binds it to a session + replies over the WS, correlated by id.
import { getSession } from '../../state/sessions'
import { parseLLSD } from '../llsd'
import { encodeLLSD } from './llsdEncode'
import { getCapDef, DEDICATED_CAPS, type CapDef } from './registry'
import { slog } from '../serverLog'
import { S } from '../../../shared/protocol.js'

export interface CapOutcome { ok: boolean; result?: any; error?: string; status?: number }

export async function runCap(
	url: string,
	def: CapDef | undefined,
	params: any,
	method: 'POST' | 'GET',
	fetchFn: typeof fetch = fetch,
): Promise<CapOutcome> {
	const payload = def?.request ? def.request(params) : params
	const res = await fetchFn(url, {
		method,
		headers: { 'Content-Type': 'application/llsd+xml', 'Accept': 'application/llsd+xml' },
		body: method === 'GET' ? undefined : encodeLLSD(payload),
		signal: AbortSignal.timeout(30_000),
	})
	const text = await res.text()
	if (!res.ok) return { ok: false, error: `http_${res.status}`, status: res.status }
	const parsed = parseLLSD(text)
	return { ok: true, result: def?.response ? def.response(parsed) : parsed }
}

/** Resolve the session's cap URL by NAME, run the round-trip, reply S.CAP_RESULT { id, cap, ... }. */
export async function invokeCap(
	circuitId: string,
	id: string,
	capName: string,
	params: any,
	method?: 'POST' | 'GET',
): Promise<void> {
	const s = getSession(circuitId)
	if (!s) return
	const reply = (d: Partial<CapOutcome>) =>
		s.ws.send(JSON.stringify({ t: S.CAP_RESULT, d: { id, cap: capName, ...d } }))

	if (DEDICATED_CAPS.has(capName)) { reply({ ok: false, error: 'dedicated_cap' }); return }
	const url = s.caps.get(capName)
	if (!url) {
		slog.warn(s.ws, `[Cap] ${capName} cap_unavailable (session has ${s.caps.size} cap(s))`)
		reply({ ok: false, error: 'cap_unavailable' })
		return
	}
	const def = getCapDef(capName)
	try {
		reply(await runCap(url, def, params, method || def?.method || 'POST'))
	} catch (e) {
		reply({ ok: false, error: (e as Error).message })
	}
}
```

> Note: if `import { getSession } from '../../state/sessions'` resolves incorrectly, check the actual path used by `server/handlers/inventory.ts` (`../state/sessions`) and adjust the relative depth — `invoke.ts` is one directory deeper (`lib/caps/`), so `../../state/sessions` is correct.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test server/__tests__/caps-invoke.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/lib/caps/invoke.ts server/__tests__/caps-invoke.test.ts
git commit -m "feat(caps): generic runCap + invokeCap"
```

---

## Task 4: Protocol constants + dispatch wiring

**Files:**
- Modify: `shared/protocol.js` (`C` block ~line 52, `S` block ~line 96)
- Modify: `server/index.ts` (imports ~line 12; dispatch ~line 224)

- [ ] **Step 1: Add the protocol constants**

In `shared/protocol.js`, add to the `C` object (after `OBJ_PROBE_RESYNC`):

```js
	CAP_CALL:       'cap_call',     // { id, cap, params, method? } — generic HTTP capability call by name
```

Add to the `S` object (after `OBJ_CACHE_PROBE`):

```js
	CAP_RESULT:     'cap_result',   // { id, cap, ok, result?, error?, status? } — generic cap reply, correlated by id
	EQ_EVENT:       'eq_event',     // { name, body } — EventQueue event with no dedicated server handler, forwarded raw
```

- [ ] **Step 2: Wire the dispatch**

In `server/index.ts`, add the import near line 12 (after the other cap handler imports):

```ts
import { invokeCap } from './lib/caps/invoke'
```

Add a case in the `switch (msg.t)` block (after the `C.CAPS_FETCH` case, ~line 224):

```ts
				case C.CAP_CALL: {
					const d = msg.d as { id: string; cap: string; params?: any; method?: 'POST' | 'GET' }
					invokeCap(circuitId, d.id, d.cap, d.params, d.method)
					break
				}
```

- [ ] **Step 3: Verify the server builds**

Run: `bun build server/index.ts --target=bun > /dev/null && echo OK`
Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
git add shared/protocol.js server/index.ts
git commit -m "feat(caps): CAP_CALL/CAP_RESULT protocol + dispatch"
```

---

## Task 5: Client useCaps composable

**Files:**
- Create: `src/composables/useCaps.js`

No unit test (thin socket glue; verified live in Task 9). Follows the `useInventory.js` singleton pattern.

- [ ] **Step 1: Write the implementation**

```js
// src/composables/useCaps.js — single front door for HTTP capability calls.
// cap('Name').post(params) → C.CAP_CALL → server invokeCap → S.CAP_RESULT → resolves the Promise.
// URLs + LLSD stay server-side; the client speaks cap NAME + plain JSON. One line wires a new cap.
import { onMounted, onUnmounted } from 'vue'
import { useRealtimeSocket } from './useRealtimeSocket'
import { C, S } from '@shared/protocol.js'

const TIMEOUT_MS = 30_000
const pending = new Map()    // id → { resolve, reject, timer }
let registered = false
let seq = 0

function nextId() { return `cap_${++seq}_${Date.now()}` }

function onCapResult(d) {
	const p = pending.get(d?.id)
	if (!p) return
	clearTimeout(p.timer)
	pending.delete(d.id)
	if (d.ok) p.resolve(d.result)
	else p.reject(new Error(d.error || 'cap_failed'))
}

export function useCaps() {
	const { on, off, emit } = useRealtimeSocket()

	function call(capName, params, method) {
		const id = nextId()
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				pending.delete(id)
				reject(new Error('cap_timeout'))
			}, TIMEOUT_MS)
			pending.set(id, { resolve, reject, timer })
			emit(C.CAP_CALL, { id, cap: capName, params, method })
		})
	}

	// cap('Name').post({...}) / .get({...})
	function cap(capName) {
		return {
			post: (params) => call(capName, params, 'POST'),
			get:  (params) => call(capName, params, 'GET'),
		}
	}

	onMounted(() => {
		if (!registered) { on(S.CAP_RESULT, onCapResult); registered = true }
	})
	onUnmounted(() => {
		if (registered) { off(S.CAP_RESULT, onCapResult); registered = false }
		for (const [, p] of pending) { clearTimeout(p.timer); p.reject(new Error('unmounted')) }
		pending.clear()
	})

	return { cap }
}
```

- [ ] **Step 2: Verify the client builds**

Run: `npm run build:prod > /dev/null 2>&1 && echo OK`
Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add src/composables/useCaps.js
git commit -m "feat(caps): client useCaps composable"
```

---

## Task 6: Data-driven EventQueue dispatch

**Files:**
- Modify: `server/lib/eventQueue.ts` (`dispatchEvent` ~line 185)
- Test: `server/__tests__/eventQueue.test.ts` (extend existing)

Goal: replace the hand-coded `switch (message)` with an `eqRegistry` map; unregistered events forward to the client as `S.EQ_EVENT { name, body }`. Registered handlers keep verbatim logic.

- [ ] **Step 1: Write the failing test**

Add to `server/__tests__/eventQueue.test.ts`:

```ts
import { eqRegistry } from '../lib/eventQueue'

describe('eqRegistry', () => {
	it('has dedicated handlers for the known events', () => {
		expect(eqRegistry.has('TeleportFinish')).toBe(true)
		expect(eqRegistry.has('TeleportFailed')).toBe(true)
		expect(eqRegistry.has('EnableSimulator')).toBe(true)
	})
	it('does not register a generic-only event', () => {
		expect(eqRegistry.has('SomeFutureEvent')).toBe(false)
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test server/__tests__/eventQueue.test.ts`
Expected: FAIL — `eqRegistry` is not exported.

- [ ] **Step 3: Refactor dispatchEvent into a registry**

In `server/lib/eventQueue.ts`, replace the entire `function dispatchEvent(...) { switch (message) { ... } }` (lines ~185–234) with:

```ts
type EqHandler = (sessionId: string, body: LLSDValue) => void

export const eqRegistry = new Map<string, EqHandler>([
	['TeleportFinish', (sessionId, body) => {
		const s = getSession(sessionId); if (!s) return
		const f = decodeTeleportFinishLLSD(body)
		if (!f || !f.simIp) { slog.warn(s.ws, `[EQ] TeleportFinish: undecodable body`); return }
		slog.info(s.ws, `[EQ] ✓ TeleportFinish ${f.simIp}:${f.simPort} handle=${f.regionHandle} cap=${f.seedCap.slice(0, 40)}…`)
		applyTeleportFinish(sessionId, f)
	}],
	['TeleportFailed', (sessionId) => {
		const s = getSession(sessionId); if (!s) return
		slog.warn(s.ws, `[EQ] TeleportFailed event`)
		const now = Date.now()
		if (!s.lastTeleportFailedAt || now - s.lastTeleportFailedAt > 5000) {
			s.lastTeleportFailedAt = now
			s.pendingTpHandle = undefined
			s.tpDebugUntil = 0
			s.ws.send(JSON.stringify({ t: S.TELEPORT_FAILED, d: { reason: 'sim reported teleport failed (EQ)' } }))
		}
	}],
	['EnableSimulator', (sessionId, body) => {
		const s = getSession(sessionId); if (!s) return
		try {
			const info = (body as Record<string, LLSDValue>)?.SimulatorInfo
			const e = (Array.isArray(info) ? info[0] : info) as Record<string, LLSDValue> | undefined
			if (e) {
				const sx = llsdNum(e.RegionSizeX), sy = llsdNum(e.RegionSizeY)
				const hb = typeof e.Handle === 'string' ? b64bytes(e.Handle) : Buffer.alloc(0)
				const handle = hb.length >= 8 ? hb.readBigUInt64BE(0) : 0n
				slog.info(s.ws, `[EQ] EnableSimulator handle=${handle} size=${sx || '?'}×${sy || '?'}`)
			} else {
				slog.info(s.ws, `[EQ] (unhandled) EnableSimulator (no SimulatorInfo)`)
			}
		} catch { slog.info(s.ws, `[EQ] (unhandled) EnableSimulator`) }
	}],
])

function dispatchEvent(sessionId: string, message: string, body: LLSDValue): void {
	const s = getSession(sessionId)
	if (!s) return
	const handler = eqRegistry.get(message)
	if (handler) { handler(sessionId, body); return }
	// No dedicated server-side logic → forward raw to the client (LLSD already decoded to JSON).
	// Reacting to a new EQ event becomes client-only work — no server restart.
	slog.info(s.ws, `[EQ] → client (generic) ${message}`)
	s.ws.send(JSON.stringify({ t: S.EQ_EVENT, d: { name: message, body } }))
}
```

> The `EstablishAgentCommunication`/`CrossedRegion` "(unhandled)" arms are intentionally dropped — they now flow through the generic `S.EQ_EVENT` forward. `b64bytes`, `llsdNum`, `decodeTeleportFinishLLSD`, `applyTeleportFinish`, `getSession`, `slog`, `S` are already imported at the top of the file; do not re-import.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test server/__tests__/eventQueue.test.ts`
Expected: PASS (existing tests + the 2 new `eqRegistry` tests).

- [ ] **Step 5: Commit**

```bash
git add server/lib/eventQueue.ts server/__tests__/eventQueue.test.ts
git commit -m "feat(caps): data-driven EventQueue dispatch + generic forward"
```

---

## Task 7: Migrate inventory onto the framework

**Files:**
- Create: `server/lib/caps/inventoryCap.ts`
- Test: `server/__tests__/caps-inventory.test.ts`
- Modify: `server/handlers/inventory.ts`

Goal: move the inventory request-build (string concat) and response-decode (item mapping) into pure, tested functions, and have `handleInventoryFetch` build the body via `encodeLLSD(buildInvRequest(...))` and decode via `decodeInvFolders(...)` — keeping the per-folder `S.INV_FOLDER` fanout, the `WebFetchInventoryDescendents` fallback name, and the empty-echo behavior. (Inventory keeps its own `fetch`, not `runCap`: its multi-folder fanout + 25 s timeout + fallback-cap-name logic don't fit `runCap`'s single-outcome shape. The win is that LLSD build/parse now flow through the tested framework primitives.) Client untouched.

- [ ] **Step 1: Write the failing test**

```ts
// server/__tests__/caps-inventory.test.ts
import { describe, it, expect } from 'bun:test'
import { buildInvRequest, decodeInvFolders } from '../lib/caps/inventoryCap'
import { encodeLLSD } from '../lib/caps/llsdEncode'
import { parseLLSD } from '../lib/llsd'

describe('inventory cap shapers', () => {
	it('builds a folders request that round-trips with the expected fields', () => {
		const req = buildInvRequest(['22222222-2222-2222-2222-222222222222'], '33333333-3333-3333-3333-333333333333')
		const back = parseLLSD(encodeLLSD(req)) as any
		expect(back.folders[0].folder_id).toBe('22222222-2222-2222-2222-222222222222')
		expect(back.folders[0].owner_id).toBe('33333333-3333-3333-3333-333333333333')
		expect(back.folders[0].fetch_folders).toBe(true)
		expect(back.folders[0].fetch_items).toBe(true)
		expect(back.folders[0].sort_order).toBe(0)
	})

	it('decodes folders → typed items with permission flags', () => {
		const xml = `<llsd><map><key>folders</key><array><map>
			<key>folder_id</key><uuid>44444444-4444-4444-4444-444444444444</uuid>
			<key>items</key><array><map>
				<key>item_id</key><uuid>55555555-5555-5555-5555-555555555555</uuid>
				<key>parent_id</key><uuid>44444444-4444-4444-4444-444444444444</uuid>
				<key>name</key><string>Hat</string>
				<key>desc</key><string>a hat</string>
				<key>type</key><integer>5</integer>
				<key>inv_type</key><integer>5</integer>
				<key>asset_id</key><uuid>66666666-6666-6666-6666-666666666666</uuid>
				<key>flags</key><integer>0</integer>
				<key>created_at</key><integer>1700000000</integer>
				<key>permissions</key><map><key>owner_mask</key><integer>${0x8000 | 0x2000}</integer></map>
			</map></array>
		</map></array></map></llsd>`
		const folders = decodeInvFolders(parseLLSD(xml))
		expect(folders).toHaveLength(1)
		expect(folders[0].folderId).toBe('44444444-4444-4444-4444-444444444444')
		const it = folders[0].items[0]
		expect(it.name).toBe('Hat')
		expect(it.assetType).toBe(5)
		expect(it.createdAt).toBe(1700000000)
		expect(it.canCopy).toBe(true)
		expect(it.canModify).toBe(false)
		expect(it.canTransfer).toBe(true)
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test server/__tests__/caps-inventory.test.ts`
Expected: FAIL — `Cannot find module '../lib/caps/inventoryCap'`.

- [ ] **Step 3: Write the shapers**

```ts
// server/lib/caps/inventoryCap.ts — FetchInventoryDescendents2 request/response shaping.
// Pure functions (tested offline) used by handlers/inventory.ts via runCap.
import type { LLSDValue } from '../llsd'
import { llsd, type LLSDTyped } from './llsdEncode'
import { llsdNum, llsdStr } from '../llsd'

export interface InvItem {
	itemId: string; parentId: string; name: string; desc: string
	assetType: number; invType: number; assetId: string; flags: number
	createdAt: number; ownerMask: number
	canCopy: boolean; canModify: boolean; canTransfer: boolean
}
export interface InvFolder { folderId: string; items: InvItem[] }

/** Build the {folders:[...]} request value. fetch_folders=1 (sim gates items on it). */
export function buildInvRequest(folderIds: string[], ownerId: string): { folders: Array<Record<string, LLSDTyped | number>> } {
	return {
		folders: folderIds.map(id => ({
			folder_id:     llsd.uuid(id),
			owner_id:      llsd.uuid(ownerId),
			fetch_folders: llsd.bool(true),
			fetch_items:   llsd.bool(true),
			sort_order:    0,
		})),
	}
}

/** Decode the FetchInventoryDescendents2 response into typed folders + items. */
export function decodeInvFolders(parsed: LLSDValue): InvFolder[] {
	const respFolders = Array.isArray((parsed as any)?.folders) ? (parsed as any).folders : []
	const out: InvFolder[] = []
	for (const f of respFolders) {
		const folderId = llsdStr(f?.folder_id)
		if (!folderId) continue
		const items: InvItem[] = (Array.isArray(f?.items) ? f.items : []).map((it: any) => {
			const perms = (it.permissions && typeof it.permissions === 'object') ? it.permissions : {}
			const ownerMask = llsdNum(perms.owner_mask)
			return {
				itemId: llsdStr(it.item_id), parentId: llsdStr(it.parent_id),
				name: llsdStr(it.name), desc: llsdStr(it.desc),
				assetType: llsdNum(it.type), invType: llsdNum(it.inv_type),
				assetId: llsdStr(it.asset_id), flags: llsdNum(it.flags),
				createdAt: llsdNum(it.created_at), ownerMask,
				canCopy: (ownerMask & 0x8000) !== 0,
				canModify: (ownerMask & 0x4000) !== 0,
				canTransfer: (ownerMask & 0x2000) !== 0,
			}
		})
		out.push({ folderId, items })
	}
	return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test server/__tests__/caps-inventory.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Rewire `handleInventoryFetch` to use the shapers + runCap**

In `server/handlers/inventory.ts`, replace the body (the `try { … }` block building `folderXml`/`body` and parsing) so it builds the request via `encodeLLSD(buildInvRequest(...))` and decodes via `decodeInvFolders`. Replace lines 32–104 (everything from the `// WHY: FetchInventoryDescendents2 accepts many folders` comment through the closing `}` of the `catch`) with:

```ts
	const reqValue = buildInvRequest(ids, s.agentId)
	try {
		const res = await fetch(cap, {
			method: 'POST',
			headers: { 'Content-Type': 'application/llsd+xml', 'Accept': 'application/llsd+xml' },
			body: encodeLLSD(reqValue),
			signal: AbortSignal.timeout(25_000),
		})
		const text = await res.text()
		const folders = decodeInvFolders(parseLLSD(text))
		if (folders.length === 0) {
			slog.warn(s.ws, `[Inv] empty response for ${ids.length} folder(s) — HTTP ${res.status}, ${text.length}B, sample: ${text.slice(0, 300).replace(/\s+/g, ' ')}`)
		}
		const seen = new Set<string>()
		let total = 0
		for (const f of folders) {
			seen.add(f.folderId)
			total += f.items.length
			s.ws.send(JSON.stringify({ t: S.INV_FOLDER, d: { folderId: f.folderId, items: f.items } }))
		}
		for (const folderId of ids) {
			if (!seen.has(folderId)) s.ws.send(JSON.stringify({ t: S.INV_FOLDER, d: { folderId, items: [] } }))
		}
		slog.info(s.ws, `[Inv] ${ids.length} folder(s) → ${total} items (HTTP ${res.status})`)
	} catch (e) {
		slog.warn(s.ws, `Inventory fetch failed: ${(e as Error).message}`)
		for (const folderId of ids) {
			s.ws.send(JSON.stringify({ t: S.INV_FOLDER, d: { folderId, items: [], error: (e as Error).message } }))
		}
	}
```

Update the imports at the top of `server/handlers/inventory.ts`:

```ts
import { parseLLSD } from '../lib/llsd'
import { encodeLLSD } from '../lib/caps/llsdEncode'
import { buildInvRequest, decodeInvFolders } from '../lib/caps/inventoryCap'
```

(Remove the now-unused `llsdNum`, `llsdStr` from the `../lib/llsd` import — `decodeInvFolders` owns that logic now.)

- [ ] **Step 6: Run the full server suite + build**

Run: `bun test && bun build server/index.ts --target=bun > /dev/null && echo BUILD_OK`
Expected: all tests PASS (no regressions), `BUILD_OK`.

- [ ] **Step 7: Commit**

```bash
git add server/lib/caps/inventoryCap.ts server/__tests__/caps-inventory.test.ts server/handlers/inventory.ts
git commit -m "refactor(caps): inventory fetch via caps framework"
```

---

## Task 8: Broaden REQUESTED_CAPS

**Files:**
- Modify: `server/handlers/login.ts` (`REQUESTED_CAPS` ~line 18)

Goal: request the broader roadmap cap set at the seed. Requesting is free; OpenSim omits unsupported caps → `cap_unavailable` is correct degradation.

- [ ] **Step 1: Extend the array**

In `server/handlers/login.ts`, add these entries to the `REQUESTED_CAPS` array (keep `EventQueueGet` first; otherwise alphabetical like FS to reduce merge noise):

```ts
	'AgentProfile',
	'CopyInventoryFromNotecard',
	'CreateInventoryCategory',
	'GetDisplayNames',
	'GetObjectCost',
	'GetObjectPhysicsData',
	'IncrementCOFVersion',
	'InventoryThumbnailUpload',
	'ObjectMedia',
	'ObjectMediaNavigate',
	'ParcelPropertiesUpdate',
	'ParcelVoiceInfoRequest',
	'RemoteParcelRequest',
	'RequestTaskInventory',
	'ResourceCostSelected',
	'SimulatorFeatures',
	'UpdateAvatarAppearance',
	'UserInfo',
```

- [ ] **Step 2: Verify the server builds**

Run: `bun build server/index.ts --target=bun > /dev/null && echo OK`
Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add server/handlers/login.ts
git commit -m "feat(caps): broaden requested cap set"
```

---

## Task 9: Full verification + live-verify (the thesis proof)

**Files:** none (verification only).

- [ ] **Step 1: Full offline gate**

Run: `bun test && npm run build:prod`
Expected: `bun test` all green (no new failures vs baseline); `build:prod` green.

- [ ] **Step 2: Reclaim Bun + restart once**

Per `CLAUDE.md`: all server edits are now batched and committed. Reclaim/own the Bun WS server, restart it once, watch `server-watch.log` directly. Tell the user: **"server settled — reconnect."**

- [ ] **Step 3: Live-verify (user drives the client)**

1. User reconnects + logs into a known grid/region.
2. Confirm inventory still loads correctly (folders expand → items appear with perms) — the migrated path works.
3. Confirm `[Cap]`/`S.CAPS_READY` shows the broadened cap set in `server-watch.log`.
4. From the browser console, prove a brand-new cap call works client-only (example):

```js
// in WorldView devtools, with useCaps mounted:
const { cap } = useCaps()
await cap('SimulatorFeatures').get()   // or another offered cap
```

Expected: a resolved Promise with the decoded LLSD JSON, **with zero further server restarts** — this is the framework thesis proven.

- [ ] **Step 4: Final commit (if any cleanup)**

```bash
git add -A
git commit -m "chore(caps): verification cleanup"
```

(Skip if nothing changed. Do not commit unless the user has confirmed — see project rule "Never Auto-Commit"; this plan's commits are drafted for the user to run.)

---

## Notes for the implementer

- **Batch server edits** (Tasks 1–4, 6–8 are all server-side). Do NOT interleave server saves with live testing — `bun run --watch` drops the circuit. Tasks 1–8 are offline-testable; only Task 9 touches a live grid.
- **`Never Auto-Commit`** is a standing project rule: the `git commit` steps are drafted for the user. If running subagent-driven, stage and present; let Gene commit.
- **Materials + assets are intentionally NOT migrated** — they use zlib + LLSD-*binary* (materials) and binary+Range (assets), which are genuinely special transports, not the generic LLSD-XML round-trip. They are declared in `DEDICATED_CAPS` (Task 2) and keep their dedicated handlers untouched. This matches the spec's "blob parsers stay bespoke" principle.
- **The old `C.INV_FETCH_FOLDER` → `S.INV_FOLDER` protocol is preserved** (client untouched); only inventory's server-side LLSD build/parse now flows through the framework. Full client migration to `cap('…').post()` is future work, not in this pass.
