# Interest Filter (single-region production) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Productionize the proven camera-driven interest filter — client-driven radius, cull-vs-delete KillObject, governor-as-radius-source, and an arrival ramp — on top of the Phase 0 spike already on `ai/interest-filter`.

**Architecture:** The Bun relay already forwards only in-volume objects and streams enter/leave (Phase 0). This plan moves the radius from a server env var to a client-sent value (governor-clamped, arrival-ramped, server hard-clamped), and marks interest-driven leaves as *culls* so the client keeps its warm `qs-objects` descriptor cache. Pure decision logic is extracted into small tested helpers; the rest is wiring.

**Tech Stack:** Bun + TypeScript (server, `bun test`), Vue 3 + Vite (client, `vitest`). Tabs not spaces. `@/` = `src/`, `@shared/` = `shared/`.

**Pre-state:** On branch `ai/interest-filter`. `server/lib/interestFilter.ts` (+ `.test.ts`, 14 tests), forward-path filter + `reconcileInterestTick` in `lludp.ts`, `sentToClient` session field, resync subset-replay — all present and green (189 server tests). The filter is gated by `INTEREST_FILTER=1` and reads `INTEREST_R` (default 96) from env.

---

## File structure

**Server**
- `server/lib/interestFilter.ts` — add `R_MIN`/`R_MAX`, `clampRadius()`, `resolveRadius(clientR)`. (pure)
- `server/state/sessions.ts` — add `interestRadius?: number` to `lastAgentParams`.
- `server/handlers/lludp.ts` — parse `interestRadius` from `C.MOVE`; feed `resolveRadius(...)` to the filter/tick; tag reconcile leaves `cull:true` and inbound sim kills `cull:false`; add cull/delete telemetry counts.

**Client**
- `src/lib/killPolicy.js` (+ test) — pure `shouldEvictOnKill({ cull, keepCacheEnv })`.
- `src/lib/interestRadiusClient.js` (+ test) — pure `computeInterestRadius({ drawDistance, underPressure, arrivalElapsedMs })`.
- `src/composables/useWorldEngine.js` — send `interestRadius` in the move builder; honor `cull` in `onKillObject`; stamp arrival time on login/TP.
- `src/composables/useLLUDP.js` — document the new `interestRadius` move field.

No new protocol message types — `C.MOVE`, `S.OBJECT_UPDATE`, `S.KILL_OBJECT` are reused with added payload fields.

---

## Task 1: Server — radius clamp + resolve (pure)

**Files:**
- Modify: `server/lib/interestFilter.ts`
- Test: `server/lib/interestFilter.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `server/lib/interestFilter.test.ts`:

```ts
import { clampRadius, resolveRadius, R_MIN, R_MAX } from './interestFilter'

describe('clampRadius', () => {
	it('clamps to [R_MIN, R_MAX]', () => {
		expect(clampRadius(10)).toBe(R_MIN)
		expect(clampRadius(99999)).toBe(R_MAX)
		expect(clampRadius(96)).toBe(96)
	})
	it('rejects non-finite values to R_MIN', () => {
		expect(clampRadius(NaN)).toBe(R_MIN)
		expect(clampRadius(undefined as unknown as number)).toBe(R_MIN)
	})
})

describe('resolveRadius', () => {
	it('uses the clamped client radius when provided', () => {
		expect(resolveRadius(120)).toBe(120)
		expect(resolveRadius(5)).toBe(R_MIN)
	})
	it('falls back to the env/default radius when client radius is absent', () => {
		// interestRadius() reads INTEREST_R (default 96) — resolveRadius(undefined) must match it.
		expect(resolveRadius(undefined)).toBe(96)
	})
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test server/lib/interestFilter.test.ts`
Expected: FAIL — `clampRadius`/`resolveRadius`/`R_MIN`/`R_MAX` not exported.

- [ ] **Step 3: Implement in `server/lib/interestFilter.ts`**

Add after `interestRadius()`:

```ts
/** Hard bounds on the interest radius. The client drives R, but the server clamps so a buggy
 *  or hostile client cannot request an unbounded radius that re-floods the tab. */
export const R_MIN = 32
export const R_MAX = 512

/** Clamp an arbitrary number into [R_MIN, R_MAX]; non-finite → R_MIN. */
export function clampRadius(r: number): number {
	if (!Number.isFinite(r)) return R_MIN
	return Math.max(R_MIN, Math.min(R_MAX, r))
}

/** Resolve the effective radius: the client-sent radius (clamped), or the env/default fallback
 *  (interestRadius()) when the client hasn't sent one yet (pre-first-MOVE). */
export function resolveRadius(clientR: number | undefined): number {
	if (typeof clientR === 'number' && Number.isFinite(clientR)) return clampRadius(clientR)
	return interestRadius()
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test server/lib/interestFilter.test.ts`
Expected: PASS (all interest filter tests).

- [ ] **Step 5: Commit**

```bash
git add server/lib/interestFilter.ts server/lib/interestFilter.test.ts
git commit -m "feat(interest): server radius clamp + client-radius resolve"
```

---

## Task 2: Server — thread client radius through MOVE

**Files:**
- Modify: `server/state/sessions.ts` (the `lastAgentParams` type)
- Modify: `server/handlers/lludp.ts:1096-1123` (MOVE decode) and the filter/tick radius reads

- [ ] **Step 1: Add the field to the session type**

In `server/state/sessions.ts`, in the `lastAgentParams` object type, add after `far: number`:

```ts
		far:       number
		interestRadius?: number   // client-desired interest radius (m); server clamps via resolveRadius
```

- [ ] **Step 2: Parse it from the MOVE payload**

In `server/handlers/lludp.ts`, in the `C.MOVE` handler, extend the destructured type and coerce. Change the `d` type to include `interestRadius?: number`, and after the `far` default (`if (typeof d.far !== 'number') d.far = 512`) add:

```ts
		if (typeof d.interestRadius !== 'number') d.interestRadius = undefined
```

(`d` is already assigned to `session.lastAgentParams`, so the field rides along.)

- [ ] **Step 3: Use the resolved radius in the filter + tick**

In `server/handlers/lludp.ts`, import `resolveRadius` (add to the existing `interestFilter` import):

```ts
import {
	interestEnabled, interestRadius, withinInterest, effectivePos, isAvatar,
	reconcileInterest, resolveRadius, type ObjLike,
} from '../lib/interestFilter'
```

In `filterForwardObjects`, replace `const r = interestRadius()` with:

```ts
	const r = resolveRadius(s.lastAgentParams?.interestRadius)
```

In `reconcileInterestTick`, replace `const r = interestRadius()` with the same line.

In `server/lib/resync.ts`, replace `const r = interestRadius()` with `const r = resolveRadius(session.lastAgentParams?.interestRadius)` and add `resolveRadius` to its `interestFilter` import.

- [ ] **Step 4: Verify build + full server tests**

Run: `bun build server/index.ts --target=bun --outfile /dev/null && bun test server/`
Expected: bundles clean; all tests PASS (189+).

- [ ] **Step 5: Commit**

```bash
git add server/state/sessions.ts server/handlers/lludp.ts server/lib/resync.ts
git commit -m "feat(interest): thread client-driven radius through MOVE"
```

---

## Task 3: Server — cull vs delete on KillObject

**Files:**
- Modify: `server/handlers/lludp.ts` (`reconcileInterestTick` leave send; inbound `KillObject` forward)

- [ ] **Step 1: Tag interest-driven leaves as culls**

In `reconcileInterestTick`, change the leave send:

```ts
	if (leave.length > 0) {
		for (const id of leave) s.sentToClient.delete(id)
		s.ws.send(JSON.stringify({ t: S.KILL_OBJECT, d: { ids: leave, cull: true } }))
	}
```

- [ ] **Step 2: Mark genuine sim kills as deletes**

In the inbound `high:${HIGH_KILL_OBJECT}` handler, change the forward:

```ts
				session.ws.send(JSON.stringify({ t: S.KILL_OBJECT, d: { ids, cull: false } }))
```

- [ ] **Step 3: Verify build + server tests**

Run: `bun build server/index.ts --target=bun --outfile /dev/null && bun test server/`
Expected: bundles clean; all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add server/handlers/lludp.ts
git commit -m "feat(interest): mark interest leaves as cull, sim kills as delete"
```

---

## Task 4: Client — cull-aware KillObject (pure helper + wiring)

**Files:**
- Create: `src/lib/killPolicy.js`
- Test: `src/__tests__/lib/killPolicy.test.js`
- Modify: `src/composables/useWorldEngine.js:2998-3008` (`onKillObject`)

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/lib/killPolicy.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { shouldEvictOnKill } from '@/lib/killPolicy'

describe('shouldEvictOnKill', () => {
	it('evicts on a genuine delete (cull false)', () => {
		expect(shouldEvictOnKill({ cull: false, keepCacheEnv: false })).toBe(true)
	})
	it('keeps the descriptor on an interest cull', () => {
		expect(shouldEvictOnKill({ cull: true, keepCacheEnv: false })).toBe(false)
	})
	it('keeps the descriptor when the keep-cache env override is set', () => {
		expect(shouldEvictOnKill({ cull: false, keepCacheEnv: true })).toBe(false)
	})
	it('treats a missing cull flag as a delete (back-compat with old server frames)', () => {
		expect(shouldEvictOnKill({ cull: undefined, keepCacheEnv: false })).toBe(true)
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/lib/killPolicy.test.js`
Expected: FAIL — cannot resolve `@/lib/killPolicy`.

- [ ] **Step 3: Implement `src/lib/killPolicy.js`**

```js
// src/lib/killPolicy.js — decide whether a KillObject should evict the persistent qs-objects
// descriptor cache. An interest-driven CULL (cull:true) is temporary — the object re-enters as the
// camera moves, so keep the descriptor (re-enter rebuilds from the server replay + warm geom/tex IDB).
// A genuine sim DELETE (cull:false / absent) evicts, as does the legacy VITE_KEEP_CACHE_ON_KILL=false
// path. The env override forces keep for grids that enable distance culling.

/**
 * @param {{ cull?: boolean, keepCacheEnv: boolean }} o
 * @returns {boolean} true → evict the descriptor; false → keep it
 */
export function shouldEvictOnKill({ cull, keepCacheEnv }) {
	if (keepCacheEnv) return false
	if (cull) return false
	return true
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/lib/killPolicy.test.js`
Expected: PASS.

- [ ] **Step 5: Wire into `onKillObject`**

In `src/composables/useWorldEngine.js`, add the import near the other `@/lib` imports:

```js
import { shouldEvictOnKill } from '@/lib/killPolicy'
```

In `onKillObject`, replace the eviction block. Current:

```js
		const key = regionCacheKey()
		const keepOnKill = import.meta.env.VITE_KEEP_CACHE_ON_KILL === 'true'
		for (const id of all) {
			pendingMeshIds.delete(id)  // perf: drop a queued-but-unbuilt mesh
			evicted.delete(id)
			removeMesh(id)
			worldStore.removeObject(id)
			// WHY: stock OpenSim has ObjectsCullingByDistance=false, so KillObject = genuine
			// delete → evict the cached entry. Grids that enable culling can set
			// VITE_KEEP_CACHE_ON_KILL=true so a cull-kill does not drop the cached object.
			if (key && !keepOnKill) objCacheEvict(key, id)
		}
```

Replace with:

```js
		const key = regionCacheKey()
		const keepCacheEnv = import.meta.env.VITE_KEEP_CACHE_ON_KILL === 'true'
		// WHY: an interest-driven leave (cull:true) is a temporary cull, not a delete — keep the
		// qs-objects descriptor so re-enter is cheap and the warm-reload cache survives touring.
		// A genuine sim delete (cull:false / absent) evicts. See src/lib/killPolicy.js.
		const evict = shouldEvictOnKill({ cull: payload?.cull, keepCacheEnv })
		for (const id of all) {
			pendingMeshIds.delete(id)  // perf: drop a queued-but-unbuilt mesh
			evicted.delete(id)
			removeMesh(id)
			worldStore.removeObject(id)
			if (key && evict) objCacheEvict(key, id)
		}
```

- [ ] **Step 6: Run client test suite + build**

Run: `npx vitest run && npm run build:prod`
Expected: PASS; build green.

- [ ] **Step 7: Commit**

```bash
git add src/lib/killPolicy.js src/__tests__/lib/killPolicy.test.js src/composables/useWorldEngine.js
git commit -m "feat(interest): client keeps descriptor on cull, evicts on delete"
```

---

## Task 5: Client — compute + send interest radius (governor-clamped, arrival-ramped)

**Files:**
- Create: `src/lib/interestRadiusClient.js`
- Test: `src/__tests__/lib/interestRadiusClient.test.js`
- Modify: `src/composables/useWorldEngine.js` (move builder ~1327-1343; arrival stamp; imports)
- Modify: `src/composables/useLLUDP.js` (jsdoc)

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/lib/interestRadiusClient.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { computeInterestRadius } from '@/lib/interestRadiusClient'

describe('computeInterestRadius', () => {
	it('returns the full draw distance once the arrival ramp completes and no pressure', () => {
		const r = computeInterestRadius({ drawDistance: 192, underPressure: false, arrivalElapsedMs: 60000 })
		expect(r).toBe(192)
	})
	it('ramps from ~half the target right after arrival', () => {
		// FS-style: start at max(target/2, 50). target=192 → start 96 at elapsed 0.
		const r = computeInterestRadius({ drawDistance: 192, underPressure: false, arrivalElapsedMs: 0 })
		expect(r).toBe(96)
	})
	it('uses a 50m floor for the ramp start on small draw distances', () => {
		// target=64 → target/2=32, floored to 50.
		const r = computeInterestRadius({ drawDistance: 64, underPressure: false, arrivalElapsedMs: 0 })
		expect(r).toBe(50)
	})
	it('shrinks the target under memory pressure', () => {
		// pressure scales target by 0.6: 192 * 0.6 = 115 (rounded), ramp complete.
		const r = computeInterestRadius({ drawDistance: 192, underPressure: true, arrivalElapsedMs: 60000 })
		expect(r).toBe(115)
	})
	it('never exceeds the (pressure-adjusted) target during the ramp', () => {
		const r = computeInterestRadius({ drawDistance: 96, underPressure: false, arrivalElapsedMs: 999999 })
		expect(r).toBe(96)
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/lib/interestRadiusClient.test.js`
Expected: FAIL — cannot resolve `@/lib/interestRadiusClient`.

- [ ] **Step 3: Implement `src/lib/interestRadiusClient.js`**

```js
// src/lib/interestRadiusClient.js — compute the interest radius the client asks the relay to filter
// to. Driven by the draw-distance slider, shrunk under memory pressure (governor), and ramped up on
// arrival (FS send_agent_update: start max(target/2, 50), grow 10%/sec to target) so the immediate
// vicinity paints first instead of bursting the whole volume.

const PRESSURE_FACTOR = 0.6   // under heap pressure, ask for a smaller volume
const RAMP_START_FLOOR = 50   // metres — FS arrival ramp floor
const RAMP_RATE_PER_S = 0.10  // +10% of target per second

/**
 * @param {{ drawDistance: number, underPressure: boolean, arrivalElapsedMs: number }} o
 * @returns {number} interest radius in metres (integer)
 */
export function computeInterestRadius({ drawDistance, underPressure, arrivalElapsedMs }) {
	let target = drawDistance
	if (underPressure) target = target * PRESSURE_FACTOR
	const start = Math.max(target / 2, RAMP_START_FLOOR)
	const elapsedS = Math.max(0, arrivalElapsedMs) / 1000
	const ramped = Math.min(target, start + elapsedS * target * RAMP_RATE_PER_S)
	return Math.round(ramped)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/lib/interestRadiusClient.test.js`
Expected: PASS.

- [ ] **Step 5: Stamp arrival time + send the radius from the move builder**

In `src/composables/useWorldEngine.js`:

Add imports near the other `@/lib` and store imports:

```js
import { computeInterestRadius } from '@/lib/interestRadiusClient'
import { memUnderPressure } from '@/lib/memGovernor'
```

Add a module-scoped arrival timestamp (near other `let` engine state, e.g. by `let ownAvatarLocalId`):

```js
	// Interest-radius arrival ramp: reset on login/TP so the volume re-ramps from the vicinity.
	let _interestArrivalAt = (typeof performance !== 'undefined' ? performance.now() : 0)
```

Set it on arrival. In the spawn/teleport-arrival handler that establishes the own avatar position
(where `ownAvatarLocalId` is assigned on a fresh spawn / `AGENT_SPAWN_POS`), add:

```js
		_interestArrivalAt = performance.now()
```

In the move builder, replace the hardcoded `far: 512` block's sibling — keep `far: 512` (Task spec §5:
sim-bound far stays region-wide) and ADD the `interestRadius` field to the `sendMove({...})` object:

```js
			far:       512,
			interestRadius: computeInterestRadius({
				drawDistance: uiStore.drawDistance,
				underPressure: memUnderPressure(),
				arrivalElapsedMs: performance.now() - _interestArrivalAt,
			}),
```

- [ ] **Step 6: Document the new field in `useLLUDP.js`**

In `src/composables/useLLUDP.js`, in the `sendMove` jsdoc, after the `@param {number} p.far` line add:

```js
	 * @param {number}   p.interestRadius  desired Bun-side interest radius (m); server clamps
```

- [ ] **Step 7: Run client test suite + build**

Run: `npx vitest run && npm run build:prod`
Expected: PASS; build green.

- [ ] **Step 8: Commit**

```bash
git add src/lib/interestRadiusClient.js src/__tests__/lib/interestRadiusClient.test.js src/composables/useWorldEngine.js src/composables/useLLUDP.js
git commit -m "feat(interest): client sends governor-clamped, arrival-ramped radius"
```

---

## Task 6: Server — cull/delete telemetry

**Files:**
- Modify: `server/handlers/lludp.ts` (`reconcileInterestTick` log line + a session delete counter)

- [ ] **Step 1: Count culls in the heartbeat log**

In `reconcileInterestTick`, the `[Interest]` log already reports `enter`/`leave`. The `leave` count IS
the cull count per tick (interest-driven). Make that explicit in the log string — change the log to label
it `cull`:

```ts
		slog.info(s.ws, `[Interest] R=${r} cam=[${cam.map(v => v.toFixed(0)).join(',')}] sent=${s.sentToClient.size}/${s.objCache.size} enter=${toEnter.length}${queued > 0 ? `(+${queued} queued)` : ''} cull=${leave.length}`)
```

- [ ] **Step 2: Verify build + server tests**

Run: `bun build server/index.ts --target=bun --outfile /dev/null && bun test server/`
Expected: bundles clean; tests PASS.

- [ ] **Step 3: Commit**

```bash
git add server/handlers/lludp.ts
git commit -m "chore(interest): label leave telemetry as cull"
```

---

## Task 7: Acceptance gate — live VAR-region validation (milestone, not code)

This is the spec's success gate (criterion 2). No code; verification only.

- [ ] **Step 1: Run the server with the filter on**

`INTEREST_FILTER=1 bun run --watch server/index.ts > server-watch.log 2>&1` (background). The radius now
comes from the client; `INTEREST_R` only sets the pre-first-MOVE fallback.

- [ ] **Step 2: Drive a heavy VAR / ~21k-object region**

Hard-reload (Ctrl+Shift+R) into the heavy region. Walk/cam across it.

- [ ] **Step 3: Confirm the bound + streaming + warm cache**

In `server-watch.log`, confirm `[Interest] … sent=N/total` stays bounded (low thousands) while `total`
climbs to ~21k, with `enter`/`cull` churning as you move. In the browser, confirm `objs`/`buildQ`/`heap`
stay bounded (no wedge) and fps stays usable. Reload after touring and confirm the warm pre-seed still
paints (descriptor cache preserved — Task 4).

- [ ] **Step 4: If proven, flip default-on (separate small change, with Gene's sign-off)**

Make `interestEnabled()` default true (or remove the gate). Out of this plan's scope until the gate passes;
record the result in memory `interest-filtering-design`.

---

## Notes for the implementer

- **Tabs, not spaces.** Match surrounding style. Vue SFC order: `<script setup>` → `<template>` → `<style>`.
- **Never auto-commit beyond the steps here** — Gene commits; the commit steps are the suggested boundaries,
  run them only if Gene has asked you to commit, otherwise stop at the green test/build.
- The server hot-restarts under `bun --watch` on every save — it drops the live circuit, so a client reload
  is needed after server edits to test live.
- `performance.now()` is used client-side for the arrival ramp (monotonic, fine in the browser). Do not use
  `Date.now()` for the ramp.
- Deferred (do NOT build here): cone-weighting/rear-cull, multi-region, springback (#15).
