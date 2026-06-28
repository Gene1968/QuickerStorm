# Stale-Scene Ghost Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On fresh login, evict objects the client still paints from its `qs-objects` IDB cache that were deleted while it was offline (the sim never re-confirms them).

**Architecture:** Server-driven. The relay already tracks `session.distinctLocalIds` (every localId seen in any probe/update = the sim's full current set, since the interest filter limits *forwarding*, not *receiving*). The client sends its pre-seeded localId set once; after the sim's enumeration goes quiet, the server diffs `clientCached − distinctLocalIds` and sends a genuine `KILL_OBJECT { deleted: true }` for the ghosts, which the client purges from scene + IDB.

**Tech Stack:** Bun + TypeScript (server), Vue 3 + Vite (client), `bun:test` (server tests), Vitest (client tests). Spec: `docs/superpowers/specs/2026-06-27-stale-scene-ghost-reconciliation-design.md`.

**Commits:** Per project rule ([[never-auto-commit]]), **the user commits**. The commit steps below give the suggested message — stage the files and let Gene run the commit.

**Build sequencing (CLAUDE.md "Batch server edits"):** Tasks 1–4 are server-side (Bun `--watch` restarts on each save, dropping the circuit). Do them as one burst, then restart Bun once and tell the user "server settled — reconnect." Tasks 5–6 are client-side (Vite HMR keeps the circuit).

---

## File Structure

| File | Responsibility |
|------|----------------|
| `shared/protocol.js` | Add `C.OBJ_CLIENT_CACHED`; document `deleted` on `KILL_OBJECT`. |
| `server/lib/ghostReconcile.ts` *(new)* | Pure logic: `findGhosts` (the diff) + `ghostReconcileReady` (settle gate). |
| `server/lib/ghostReconcile.test.ts` *(new)* | Unit tests for both pure helpers. |
| `server/state/sessions.ts` | `CircuitState` fields: `clientCached`, `ghostReconcileDone`, `regionEnteredAt`. |
| `server/handlers/login.ts` | Initialise the three new session fields. |
| `server/handlers/lludp.ts` | `OBJ_CLIENT_CACHED` handler; `reconcileGhosts` called from the heartbeat; region-change reset. |
| `src/lib/killPolicy.js` (+ test) | `deleted` flag forces evict. |
| `src/composables/useWorldEngine.js` | Send `OBJ_CLIENT_CACHED` after pre-seed; pass `deleted` into `shouldEvictOnKill`. |

---

## Task 1: Protocol constants

**Files:**
- Modify: `shared/protocol.js` (the `C` client→server block near line 52; the `S` `KILL_OBJECT` doc near line 74)

- [ ] **Step 1: Add the client→server message constant**

In `shared/protocol.js`, immediately after the `OBJ_PROBE_RESYNC` line (line 52) in the `C` object, add:

```js
	OBJ_CLIENT_CACHED: 'obj_client_cached', // { ids:number[] } — localIds the client pre-seeded from qs-objects IDB this region; server diffs vs distinctLocalIds to find ghosts (objects deleted while offline)
```

- [ ] **Step 2: Document the `deleted` field on KILL_OBJECT**

Replace the `KILL_OBJECT` line (line 74) in the `S` object with:

```js
	KILL_OBJECT:     'kill_obj',      // { ids:number[], cull?:boolean, deleted?:boolean } — sim/relay removed these localIds. cull:true = interest-leave (keep IDB descriptor); deleted:true = ghost reconciliation (always purge IDB)
```

- [ ] **Step 3: Verify it parses**

Run: `bun -e "const {C,S}=require('./shared/protocol.js'); console.log(C.OBJ_CLIENT_CACHED, S.KILL_OBJECT)"`
Expected: `obj_client_cached kill_obj`

- [ ] **Step 4: Commit** (stage; Gene commits)

```bash
git add shared/protocol.js
git commit -m "feat(proto): OBJ_CLIENT_CACHED + KILL deleted flag"
```

---

## Task 2: Pure ghost-reconcile logic + tests

**Files:**
- Create: `server/lib/ghostReconcile.ts`
- Test: `server/lib/ghostReconcile.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `server/lib/ghostReconcile.test.ts`:

```ts
import { describe, it, expect } from 'bun:test'
import { findGhosts, ghostReconcileReady } from './ghostReconcile'

describe('findGhosts', () => {
	it('returns clientCached ids absent from distinctLocalIds', () => {
		const client = new Set([1, 2, 3, 4])
		const distinct = new Set([2, 4])
		expect(findGhosts(client, distinct).sort()).toEqual([1, 3])
	})
	it('returns [] when every cached id is still live', () => {
		expect(findGhosts(new Set([1, 2]), new Set([1, 2, 9]))).toEqual([])
	})
	it('returns [] for a null clientCached', () => {
		expect(findGhosts(null, new Set([1]))).toEqual([])
	})
	it('returns [] for an empty clientCached', () => {
		expect(findGhosts(new Set(), new Set([1]))).toEqual([])
	})
})

describe('ghostReconcileReady', () => {
	const ok = { hasClientCached: true, done: false, msSinceProbe: 4000, msSinceLogin: 6000 }
	it('is ready when all gates pass', () => {
		expect(ghostReconcileReady(ok)).toBe(true)
	})
	it('is not ready without a client cached set', () => {
		expect(ghostReconcileReady({ ...ok, hasClientCached: false })).toBe(false)
	})
	it('is not ready once already done', () => {
		expect(ghostReconcileReady({ ...ok, done: true })).toBe(false)
	})
	it('is not ready while probes still stream (quiet < 3s)', () => {
		expect(ghostReconcileReady({ ...ok, msSinceProbe: 1000 })).toBe(false)
	})
	it('is not ready during the initial flood (login < 5s)', () => {
		expect(ghostReconcileReady({ ...ok, msSinceLogin: 2000 })).toBe(false)
	})
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test server/lib/ghostReconcile.test.ts`
Expected: FAIL — `Cannot find module './ghostReconcile'`.

- [ ] **Step 3: Write the implementation**

Create `server/lib/ghostReconcile.ts`:

```ts
// server/lib/ghostReconcile.ts — pure core for stale-scene ghost reconciliation.
// A "ghost" is an object the client still paints from its persistent qs-objects IDB cache but the sim
// never mentioned this session (no ObjectUpdate, no ObjectUpdateCached probe) — i.e. deleted while the
// client was offline. distinctLocalIds is the sim's FULL current set (the interest filter limits what
// the relay FORWARDS, not what it RECEIVES), so the diff below cannot touch out-of-interest live
// objects. See docs/superpowers/specs/2026-06-27-stale-scene-ghost-reconciliation-design.md.

/** Client-cached localIds absent from the sim's session enumeration → genuine ghosts to evict. */
export function findGhosts(clientCached: Set<number> | null, distinctLocalIds: Set<number>): number[] {
	if (!clientCached) return []
	const ghosts: number[] = []
	for (const id of clientCached) if (!distinctLocalIds.has(id)) ghosts.push(id)
	return ghosts
}

export interface GhostReconcileGate {
	hasClientCached: boolean
	done: boolean
	msSinceProbe: number   // since the last ObjectUpdateCached probe (enumeration-quiet signal)
	msSinceLogin: number   // since region entry / login (don't fire mid-flood)
}

/** Enumeration has settled: client set received, not yet run, probes quiet ≥3s, past the ≥5s flood. */
export function ghostReconcileReady(g: GhostReconcileGate): boolean {
	const QUIET_MS = 3000
	const MIN_LOGIN_MS = 5000
	return g.hasClientCached && !g.done && g.msSinceProbe >= QUIET_MS && g.msSinceLogin >= MIN_LOGIN_MS
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test server/lib/ghostReconcile.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit** (stage; Gene commits)

```bash
git add server/lib/ghostReconcile.ts server/lib/ghostReconcile.test.ts
git commit -m "feat(ghost): pure findGhosts + settle gate"
```

---

## Task 3: Session state fields

**Files:**
- Modify: `server/state/sessions.ts` (`CircuitState` interface, after `sentToClient` line 156)
- Modify: `server/handlers/login.ts` (session literal, after `sentToClient:` line 251)

- [ ] **Step 1: Add the interface fields**

In `server/state/sessions.ts`, immediately after the `sentToClient: Set<number>` line (156), add:

```ts
	/** localIds the client pre-seeded from its qs-objects IDB for the current region run. Diffed
	 *  against distinctLocalIds to find ghosts. Null until OBJ_CLIENT_CACHED arrives. */
	clientCached: Set<number> | null
	/** One-shot guard: ghost reconciliation has already run for the current region run. */
	ghostReconcileDone: boolean
	/** Timestamp of region entry / login — min-age gate so reconcile never fires during the flood. */
	regionEnteredAt: number
```

- [ ] **Step 2: Initialise them at session creation**

In `server/handlers/login.ts`, immediately after the `sentToClient: new Set<number>(),` line (251), add:

```ts
		clientCached:       null,
		ghostReconcileDone: false,
		regionEnteredAt:    Date.now(),
```

- [ ] **Step 3: Verify the server still type-checks / boots**

Run: `bun test server/` (the suite imports the session + login modules)
Expected: PASS — same green baseline (290 tests + the 9 new from Task 2 = 299), no errors.

- [ ] **Step 4: Commit** (stage; Gene commits)

```bash
git add server/state/sessions.ts server/handlers/login.ts
git commit -m "feat(ghost): session fields for reconciliation"
```

---

## Task 4: Server wiring (handler + reconcile tick + region reset)

**Files:**
- Modify: `server/handlers/lludp.ts` — import (top, near line 44); region-change reset (after line 136); `OBJ_CLIENT_CACHED` handler (after the `OBJ_CACHE_MISS` handler, line 1373); `reconcileGhosts` function (after `reconcileInterestTick`, line 1940); heartbeat call (after line 2001)

- [ ] **Step 1: Import the pure helpers**

In `server/handlers/lludp.ts`, immediately after the existing interest-filter import (the line ending `reconcileInterest, resolveRadius, type ObjLike,` block around line 44), add:

```ts
import { findGhosts, ghostReconcileReady } from '../lib/ghostReconcile'
```

- [ ] **Step 2: Reset the new fields on region change**

In the circuit-swap teardown, immediately after `session.sentToClient.clear()` (line 136), add:

```ts
	session.clientCached = null
	session.ghostReconcileDone = false
	session.regionEnteredAt = Date.now()
```

- [ ] **Step 3: Handle the client's cached-set message**

Immediately after the closing `}` of the `OBJ_CACHE_MISS` handler (line 1373), add:

```ts
	if (msg.t === C.OBJ_CLIENT_CACHED) {
		// Client finished pre-seeding from qs-objects IDB and reports the localIds it is painting for
		// this region. reconcileGhosts (heartbeat) diffs these against the sim's enumeration once it
		// settles. See docs/superpowers/specs/2026-06-27-stale-scene-ghost-reconciliation-design.md.
		const d = msg.d as { ids: number[] }
		session.clientCached = new Set(d?.ids ?? [])
		session.ghostReconcileDone = false
		slog.info(session.ws, `[GhostReconcile] client cached set: ${session.clientCached.size} ids`)
		return
	}
```

- [ ] **Step 4: Add the reconcile function**

Immediately after the closing `}` of `reconcileInterestTick` (line 1940), add:

```ts
/**
 * One-shot per region: evict ghosts — objects the client still paints from its IDB cache that the sim
 * never mentioned this session (deleted while offline). Safe because distinctLocalIds is the sim's full
 * enumeration (interest filter limits forwarding, not receiving). Sends a genuine KILL_OBJECT
 * { deleted:true } so the client purges IDB. See the design doc cited above.
 */
function reconcileGhosts(s: CircuitState): void {
	const now = Date.now()
	if (!ghostReconcileReady({
		hasClientCached: s.clientCached !== null,
		done: s.ghostReconcileDone,
		msSinceProbe: now - (s.lastProbeRxAt ?? 0),
		msSinceLogin: now - (s.regionEnteredAt ?? 0),
	})) return
	s.ghostReconcileDone = true
	const ghosts = findGhosts(s.clientCached, s.distinctLocalIds)
	const cachedSize = s.clientCached!.size
	if (ghosts.length === 0) {
		slog.info(s.ws, `[GhostReconcile] clientCached=${cachedSize} distinct=${s.distinctLocalIds.size} ghosts=0`)
		return
	}
	for (const id of ghosts) s.clientCached!.delete(id)
	s.ws.send(JSON.stringify({ t: S.KILL_OBJECT, d: { ids: ghosts, deleted: true } }))
	const shown = ghosts.slice(0, 20).join(',')
	slog.info(s.ws, `[GhostReconcile] clientCached=${cachedSize} distinct=${s.distinctLocalIds.size} ghosts=${ghosts.length} killed=[${shown}${ghosts.length > 20 ? ',…' : ''}]`)
}
```

- [ ] **Step 5: Call it from the heartbeat**

Immediately after the `reconcileInterestTick(s)` call (line 2001), add:

```ts
		reconcileGhosts(s)
```

- [ ] **Step 6: Verify the server boots and tests pass**

Run: `bun test server/`
Expected: PASS (299 tests, no errors). The handler/tick are exercised live, not unit-tested.

- [ ] **Step 7: Commit** (stage; Gene commits)

```bash
git add server/handlers/lludp.ts
git commit -m "feat(ghost): server reconcile handler + tick"
```

- [ ] **Step 8: SERVER BURST DONE — restart Bun once, tell the user "server settled — reconnect."**

(Owner runs/owns the Bun bg task and reads `server-watch.log` — see [[own-bun-and-watch-logs]].) Confirm the boot lines (`listening on http://localhost:8787` + `udp-self-test ✓ PASS`) before continuing to the client tasks.

---

## Task 5: Client kill-policy `deleted` flag

**Files:**
- Modify: `src/lib/killPolicy.js`
- Test: `src/__tests__/lib/killPolicy.test.js`

- [ ] **Step 1: Write the failing test**

In `src/__tests__/lib/killPolicy.test.js`, add inside the `describe('shouldEvictOnKill', …)` block:

```js
	it('evicts when deleted=true, even with keepCacheEnv (confirmed-dead reconciliation)', () => {
		expect(shouldEvictOnKill({ deleted: true, cull: true, keepCacheEnv: true })).toBe(true)
	})
	it('falls through to existing logic when deleted is absent', () => {
		expect(shouldEvictOnKill({ cull: true, keepCacheEnv: false })).toBe(false)
	})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/lib/killPolicy.test.js`
Expected: FAIL — the `deleted: true` case returns `false` (current code ignores `deleted` and `keepCacheEnv` wins).

- [ ] **Step 3: Implement the flag**

Replace the body of `src/lib/killPolicy.js` (the function + its doc) with:

```js
// src/lib/killPolicy.js — decide whether a KillObject should evict the persistent qs-objects
// descriptor cache. A ghost reconciliation (deleted:true) is confirmed-dead → ALWAYS evict, even with
// keepCacheEnv. An interest-driven CULL (cull:true) is temporary — the object re-enters as the camera
// moves, so keep the descriptor. A genuine sim DELETE (cull:false / absent) evicts. The env override
// (VITE_KEEP_CACHE_ON_KILL) forces keep for routine kills on grids that enable distance culling, but
// never overrides a confirmed delete.

/**
 * @param {{ cull?: boolean, keepCacheEnv: boolean, deleted?: boolean }} o
 * @returns {boolean} true → evict the descriptor; false → keep it
 */
export function shouldEvictOnKill({ cull, keepCacheEnv, deleted }) {
	if (deleted) return true
	if (keepCacheEnv) return false
	if (cull) return false
	return true
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/lib/killPolicy.test.js`
Expected: PASS (all existing + 2 new).

- [ ] **Step 5: Commit** (stage; Gene commits)

```bash
git add src/lib/killPolicy.js src/__tests__/lib/killPolicy.test.js
git commit -m "feat(ghost): killPolicy deleted flag"
```

---

## Task 6: Client wiring (send cached-set; honour `deleted`)

**Files:**
- Modify: `src/composables/useWorldEngine.js` — `preseedRegionCache` (before `requestProbeResync()` at line 632); `onKillObject` (line 3020)

- [ ] **Step 1: Send OBJ_CLIENT_CACHED after a successful pre-seed**

In `src/composables/useWorldEngine.js`, immediately before the `requestProbeResync()` call at the end of the normal pre-seed path (line 632, just after the `objCachePruneRegions()` line 631), add:

```js
			// Report the localIds we just painted so the server can diff them against the sim's
			// enumeration and KillObject ghosts (objects deleted while we were offline). Skipped on
			// the purge path above (nothing painted → clientCached stays null → no reconcile).
			const cachedIds = []
			for (const o of (cached ?? [])) {
				if (typeof o?.localId === 'number' && o.pcode !== PCODE_AVATAR) cachedIds.push(o.localId)
			}
			try { wsEmit(C.OBJ_CLIENT_CACHED, { ids: cachedIds }) } catch { /* not connected — reconciles next session */ }
```

- [ ] **Step 2: Pass `deleted` into the evict decision**

In `onKillObject`, replace the `evict` line (3020):

```js
		const evict = shouldEvictOnKill({ cull: payload?.cull, keepCacheEnv })
```

with:

```js
		const evict = shouldEvictOnKill({ cull: payload?.cull, keepCacheEnv, deleted: payload?.deleted })
```

- [ ] **Step 3: Verify the client build is clean**

Run: `npm run build:prod`
Expected: build succeeds (ESLint is broken repo-wide — see [[eslint-broken-flat-config]] — so the build + vitest are the gates, not lint).

- [ ] **Step 4: Commit** (stage; Gene commits)

```bash
git add src/composables/useWorldEngine.js
git commit -m "feat(ghost): client sends cached set, honours deleted"
```

---

## Task 7: Live verification

- [ ] **Step 1: Reproduce the bug's setup** — log into a region where objects were rezzed AND deleted while the client was offline (the reported repro). The client pre-seeds and paints them.

- [ ] **Step 2: Watch the server log** (`server-watch.log`). Within ~5–8 s of login expect one line:

```
[GhostReconcile] clientCached=N distinct=M ghosts=K killed=[…]
```

with `K > 0` for a region that has ghosts.

- [ ] **Step 3: Confirm the ghosts vanish** from the 3D scene shortly after that line.

- [ ] **Step 4: Confirm permanence** — fully log out and back in. The ghosts no longer appear (they were evicted from `qs-objects` IDB, so they aren't even pre-seeded the second time). `[GhostReconcile] … ghosts=0` on the second login.

- [ ] **Step 5: Confirm no false kills** — tour the region (move the camera so out-of-interest objects stream in). Nothing that should exist disappears; the working set behaves as before. (Out-of-interest live objects are in `distinctLocalIds`, so they're never in the ghost diff.)

---

## Self-Review Notes

- **Spec coverage:** data flow (Tasks 1,4,6) · settle gating (Task 2 `ghostReconcileReady`, Task 4 wiring) · kill path + `deleted` override (Tasks 1,5,6) · region-change reset (Task 4 Step 2) · empty/own-avatar/false-positive edges (covered by `findGhosts` null/empty handling + pcode filter in Task 6 + self-heal via live updates) · telemetry (Task 4 Step 4) · live verification (Task 7). All spec sections map to a task.
- **Settle signal:** uses `s.lastProbeRxAt` (matching `drainProbeResync`'s existing quiescence detector) plus the ≥5 s `regionEnteredAt` floor — consistent with the spec.
- **Type consistency:** `findGhosts(Set|null, Set)`, `ghostReconcileReady(GhostReconcileGate)`, `shouldEvictOnKill({cull,keepCacheEnv,deleted})`, message `{ ids }` / `{ ids, deleted }` are used identically across server and client tasks.
