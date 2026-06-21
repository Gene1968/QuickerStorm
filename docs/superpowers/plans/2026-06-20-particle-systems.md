# Particle Systems (PSBlock) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render in-world particle systems (fountains, fire, smoke, sparkle, glow) that today render as nothing — decode the `PSBlock`, forward a compact `psys`, and simulate/draw it client-side with hard performance + heap caps.

**Architecture:** Pure, unit-tested decode (`server/lib/particleCodec.ts`) replaces the blind `skipVar1('PSBlock')`; a compact `psys` rides the existing `obj_upd` record. Client-side, a pure typed-array simulator (`src/lib/particleSim.js`) is driven by a composable (`src/composables/useParticles.js`) that owns one `THREE.Points` per emitter, resolves textures via the existing cache, and enforces global/per-emitter caps, distance culling, and heap-awareness; the engine wires it in at three small touch points.

**Tech Stack:** Bun + TypeScript (server), Vue 3 + Three.js (client), vitest (client lib), bun test (server lib).

**Reference (local Firestorm checkout — `C:\Users\gene1\Downloads\Pages\git\phoenix-firestorm`):**
- Wire layout: `indra/llmessage/llpartdata.{cpp,h}` — **verified byte-identical to the upstream LL viewer** (FS only adds `asLLSD`/`fromLLSD` editor helpers; `unpackSystem`/`unpackLegacy`/`unpack`/`unpackBlock` + constants + fixed-point fields are unchanged). Constants: `PS_SYS_DATA_BLOCK_SIZE=68`, `PS_LEGACY_PART_DATA_BLOCK_SIZE=18`, `PS_LEGACY_DATA_BLOCK_SIZE=86`, `PS_MAX_DATA_BLOCK_SIZE=104`. Fixed-point reader `unpackFixed(is_signed,int_bits,frac_bits)`: total bits = `int_bits+frac_bits(+1 if signed)` → 1 byte if ≤8 else 2 bytes if ≤16; `value = raw / 2^frac_bits`; if signed `value -= 2^int_bits`.
- Runtime simulation (what v1 mimics): `indra/newview/llviewerpartsource.cpp` (`LLViewerPartSourceScript::update` spawn block — Task 5 replicates its pattern/velocity/burst-radius math) and `llviewerpartsim.cpp`.
- Authoring suite (Editor/Inject/Explorer/Rip) lives in `indra/newview/particleeditor.{cpp,h}` — **a separate follow-up phase, NOT v1** (see "Follow-up" at the end).

**Scope (from the approved spec, `docs/superpowers/specs/2026-06-20-particle-systems-design.md`):** v1 = "common-case faithful". Patterns DROP/EXPLODE/ANGLE/ANGLE_CONE; flags interp-color, interp-scale, emissive/glow, follow-source; alpha + additive blend; real texture via cache with a **runtime-generated soft radial sprite fallback** (refinement over the spec's "bundled WebP" — no binary asset to commit, never 404s, works for alpha and additive). Decode is wired into the **full `ObjectUpdate`** path only; `ObjectUpdateCompressed` particle decode is a documented follow-up. Deferred: target-follow/ribbon/beam, wind, bounce.

---

## File Structure

| File | Create/Modify | Responsibility |
|------|---------------|----------------|
| `server/lib/particleCodec.ts` | Create | Pure `decodeParticleSystem(buf, off, len) → ParticleSys \| null`. Defensive, bounds-checked, fixed-point readers. |
| `server/lib/particleCodec.test.ts` | Create | bun tests: legacy, new-format, glow/blend, truncated/oversize/crc-0. |
| `server/lib/lludp-codec.ts` | Modify | Replace `skipVar1('PSBlock')` (line ~1536) with bounded decode; declare `psys` before the tail `try`; add `psys` to the pushed record (~1572) and to the `ObjectData` interface (~1041). |
| `server/handlers/lludp.ts` | Modify | Env-gated (`PS_BYTE_DUMP`) once-per-localId hex dump for live verification. |
| `shared/protocol.js` | Modify | Document the new optional `psys` field on the `OBJECT_UPDATE` record. |
| `src/lib/particleSim.js` | Create | Pure typed-array simulation: caps math, initial velocity per pattern, spawn, step/integrate/retire, interpolation. No Three.js. |
| `src/lib/particleSim.test.js` | Create | vitest: caps clamp, spawn timing, per-pattern velocity, retirement, cap enforcement, interp endpoints. |
| `src/composables/useParticles.js` | Create | Owns the `Points` pool + shader material, texture resolution + radial fallback, global/per-emitter caps, distance cull, heap-awareness. API: `register`, `unregister`, `step`, `stats`, `dispose`. |
| `src/composables/useWorldEngine.js` | Modify | `register`/`unregister` emitters in `upsertMesh`/`removeMesh`; call `particles.step(dt, camPos)` in `animate()`; add `[Particles]` telemetry. |

---

## Task 1: Server decode — pure `decodeParticleSystem`

**Files:**
- Create: `server/lib/particleCodec.ts`
- Test: `server/lib/particleCodec.test.ts`

**Reference layout (from `llpartdata.cpp`, locked):**

`unpackSystem` (68 bytes, in order): `CRC` U32 · `srcFlags` U32 · `pattern` U8 · `maxAge` fixed(u,8,8) · `startAge` fixed(u,8,8) · `innerAngle` fixed(u,3,5) · `outerAngle` fixed(u,3,5) · `burstRate` fixed(u,8,8) [then `max(0.01)`] · `burstRadius` fixed(u,8,8) · `burstSpeedMin` fixed(u,8,8) · `burstSpeedMax` fixed(u,8,8) · `burstPartCount` U8 · `angularVelocity` 3× fixed(s,8,7) · `partAccel` 3× fixed(s,8,7) · `partTexture` UUID(16) · `target` UUID(16).

`LLPartData::unpackLegacy` (18 bytes): `partFlags` U32 · `partMaxAge` fixed(u,8,8) · `startColor` RGBA(4×U8) · `endColor` RGBA(4×U8) · `startScale` 2× fixed(u,3,5) · `endScale` 2× fixed(u,3,5).

New format (`len != 86`): leading S32 `syssize` (must == 68) → `unpackSystem` → S32 `partsize` → `unpackLegacy` → if `partFlags & 0x10000` (GLOW): `startGlow`,`endGlow` U8/255 → if `partFlags & 0x20000` (BLEND): `blendFuncSource`,`blendFuncDest` U8.

Detection: `len==0`→null; `len>104`→null; `len==86`→legacy; else new. `crc==0`→null.

- [ ] **Step 1: Write the failing test**

```ts
// server/lib/particleCodec.test.ts
import { describe, it, expect } from 'bun:test'
import { decodeParticleSystem, PS } from './particleCodec.ts'

// Build a synthetic LEGACY (86-byte) block matching llpartdata.cpp.
function fixedU(value: number, intBits: number, fracBits: number): Buffer {
	const total = intBits + fracBits
	const raw = Math.round(value * (1 << fracBits))
	if (total <= 8) return Buffer.from([raw & 0xff])
	const b = Buffer.alloc(2); b.writeUInt16LE(raw & 0xffff, 0); return b
}
function fixedS(value: number, intBits: number, fracBits: number): Buffer {
	const total = intBits + fracBits + 1
	const raw = Math.round((value + (1 << intBits)) * (1 << fracBits))
	if (total <= 8) return Buffer.from([raw & 0xff])
	const b = Buffer.alloc(2); b.writeUInt16LE(raw & 0xffff, 0); return b
}
function u32(n: number) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b }
const ZERO16 = Buffer.alloc(16)

function legacyBlock(): Buffer {
	return Buffer.concat([
		u32(0x12345678),                 // CRC (non-zero)
		u32(0),                          // srcFlags
		Buffer.from([PS.PATTERN_ANGLE_CONE]),
		fixedU(2.0, 8, 8),               // maxAge
		fixedU(0.0, 8, 8),               // startAge
		fixedU(0.5, 3, 5),               // innerAngle
		fixedU(1.5, 3, 5),               // outerAngle
		fixedU(0.1, 8, 8),               // burstRate
		fixedU(0.0, 8, 8),               // burstRadius
		fixedU(1.0, 8, 8),               // burstSpeedMin
		fixedU(2.0, 8, 8),               // burstSpeedMax
		Buffer.from([4]),                // burstPartCount
		fixedS(0, 8, 7), fixedS(0, 8, 7), fixedS(0, 8, 7),       // angVel
		fixedS(0, 8, 7), fixedS(0, 8, 7), fixedS(-1.5, 8, 7),    // accel (gravity-ish)
		ZERO16,                          // partTexture (zero → null)
		ZERO16,                          // target
		// --- part data (18) ---
		u32(PS.PART_INTERP_COLOR | PS.PART_INTERP_SCALE),
		fixedU(3.0, 8, 8),               // partMaxAge
		Buffer.from([255, 0, 0, 255]),   // startColor RGBA
		Buffer.from([0, 0, 255, 0]),     // endColor RGBA
		fixedU(0.5, 3, 5), fixedU(0.5, 3, 5),   // startScale
		fixedU(1.0, 3, 5), fixedU(1.0, 3, 5),   // endScale
	])
}

describe('decodeParticleSystem', () => {
	it('decodes a legacy 86-byte block', () => {
		const blk = legacyBlock()
		expect(blk.length).toBe(86)
		const ps = decodeParticleSystem(blk, 0, blk.length)!
		expect(ps).not.toBeNull()
		expect(ps.pattern).toBe(PS.PATTERN_ANGLE_CONE)
		expect(ps.maxAge).toBeCloseTo(2.0, 2)
		expect(ps.burstRate).toBeCloseTo(0.1, 2)
		expect(ps.burstPartCount).toBe(4)
		expect(ps.partAccel[2]).toBeCloseTo(-1.5, 1)
		expect(ps.texture).toBeNull()
		expect(ps.startColor).toEqual([1, 0, 0, 1])
		expect(ps.endColor).toEqual([0, 0, 1, 0])
		expect(ps.startScale[0]).toBeCloseTo(0.5, 2)
		expect(ps.partFlags & PS.PART_INTERP_COLOR).toBeTruthy()
	})

	it('returns null on empty, oversize, and crc=0', () => {
		expect(decodeParticleSystem(Buffer.alloc(0), 0, 0)).toBeNull()
		expect(decodeParticleSystem(Buffer.alloc(200), 0, 120)).toBeNull()
		const z = legacyBlock(); z.writeUInt32LE(0, 0) // crc=0
		expect(decodeParticleSystem(z, 0, z.length)).toBeNull()
	})

	it('does not throw on a truncated block', () => {
		const blk = legacyBlock().subarray(0, 40)
		expect(() => decodeParticleSystem(blk, 0, 40)).not.toThrow()
		expect(decodeParticleSystem(blk, 0, 40)).toBeNull()
	})

	it('decodes a new-format block with glow + blend', () => {
		const sys = legacyBlock().subarray(0, 68)
		const part = Buffer.concat([
			u32(PS.PART_DATA_GLOW | PS.PART_DATA_BLEND),
			fixedU(3.0, 8, 8),
			Buffer.from([255, 255, 255, 255]), Buffer.from([255, 255, 255, 0]),
			fixedU(1, 3, 5), fixedU(1, 3, 5), fixedU(1, 3, 5), fixedU(1, 3, 5),
			Buffer.from([128]), Buffer.from([64]),   // start/end glow
			Buffer.from([7]), Buffer.from([9]),      // blend src/dest
		])
		const blk = Buffer.concat([u32(68), sys, u32(part.length), part])
		const ps = decodeParticleSystem(blk, 0, blk.length)!
		expect(ps).not.toBeNull()
		expect(ps.startGlow).toBeCloseTo(128 / 255, 3)
		expect(ps.blendFuncSource).toBe(7)
		expect(ps.blendFuncDest).toBe(9)
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test server/lib/particleCodec.test.ts`
Expected: FAIL — `Cannot find module './particleCodec.ts'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// server/lib/particleCodec.ts
// Pure decoder for the LLUDP ObjectUpdate PSBlock (particle system).
// Layout verified against Second Life viewer indra/llmessage/llpartdata.{cpp,h}.
// Returns floats already converted from the SL fixed-point packing, so the client
// consumes clean values. Never throws; bounds-checked against `len`.

const PS_SYS_DATA_BLOCK_SIZE = 68
const PS_LEGACY_DATA_BLOCK_SIZE = 86
const PS_MAX_DATA_BLOCK_SIZE = 104

export const PS = {
	// source patterns (mPattern)
	PATTERN_DROP: 0x01, PATTERN_EXPLODE: 0x02, PATTERN_ANGLE: 0x04,
	PATTERN_ANGLE_CONE: 0x08, PATTERN_ANGLE_CONE_EMPTY: 0x10,
	// part flags (mPartData.mFlags)
	PART_INTERP_COLOR: 0x01, PART_INTERP_SCALE: 0x02, PART_BOUNCE: 0x04, PART_WIND: 0x08,
	PART_FOLLOW_SRC: 0x10, PART_FOLLOW_VELOCITY: 0x20, PART_TARGET_POS: 0x40,
	PART_EMISSIVE: 0x100, PART_BEAM: 0x200, PART_RIBBON: 0x400,
	PART_DATA_GLOW: 0x10000, PART_DATA_BLEND: 0x20000,
} as const

export interface ParticleSys {
	crc: number; srcFlags: number; pattern: number
	maxAge: number; startAge: number; innerAngle: number; outerAngle: number
	burstRate: number; burstRadius: number; burstSpeedMin: number; burstSpeedMax: number
	burstPartCount: number
	angularVelocity: [number, number, number]; partAccel: [number, number, number]
	texture: string | null; target: string | null
	partFlags: number; partMaxAge: number
	startColor: [number, number, number, number]; endColor: [number, number, number, number]
	startScale: [number, number]; endScale: [number, number]
	startGlow: number; endGlow: number; blendFuncSource: number; blendFuncDest: number
}

const ZERO_UUID = '00000000-0000-0000-0000-000000000000'

function uuidAt(buf: Buffer, p: number): string | null {
	let h = ''
	for (let i = 0; i < 16; i++) h += buf[p + i].toString(16).padStart(2, '0')
	const u = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
	return u === ZERO_UUID ? null : u
}

class Reader {
	off: number; end: number; buf: Buffer; ok = true
	constructor(buf: Buffer, off: number, len: number) { this.buf = buf; this.off = off; this.end = off + len }
	private need(n: number): boolean { if (this.off + n > this.end) { this.ok = false; return false } return true }
	u8(): number { if (!this.need(1)) return 0; return this.buf[this.off++] }
	u16(): number { if (!this.need(2)) return 0; const v = this.buf.readUInt16LE(this.off); this.off += 2; return v }
	u32(): number { if (!this.need(4)) return 0; const v = this.buf.readUInt32LE(this.off); this.off += 4; return v }
	s32(): number { if (!this.need(4)) return 0; const v = this.buf.readInt32LE(this.off); this.off += 4; return v }
	uuid(): string | null { if (!this.need(16)) return null; const u = uuidAt(this.buf, this.off); this.off += 16; return u }
	// SL unpackFixed: total bits = int+frac(+1 if signed). value = raw/2^frac; signed → -2^int.
	fixed(signed: boolean, intBits: number, fracBits: number): number {
		const total = intBits + fracBits + (signed ? 1 : 0)
		const raw = total <= 8 ? this.u8() : this.u16()
		let v = raw / (1 << fracBits)
		if (signed) v -= (1 << intBits)
		return v
	}
	rgba(): [number, number, number, number] {
		return [this.u8() / 255, this.u8() / 255, this.u8() / 255, this.u8() / 255]
	}
}

function readSystem(r: Reader): Partial<ParticleSys> {
	const crc = r.u32()
	const srcFlags = r.u32()
	const pattern = r.u8()
	const maxAge = r.fixed(false, 8, 8)
	const startAge = r.fixed(false, 8, 8)
	const innerAngle = r.fixed(false, 3, 5)
	const outerAngle = r.fixed(false, 3, 5)
	const burstRate = Math.max(0.01, r.fixed(false, 8, 8))
	const burstRadius = r.fixed(false, 8, 8)
	const burstSpeedMin = r.fixed(false, 8, 8)
	const burstSpeedMax = r.fixed(false, 8, 8)
	const burstPartCount = r.u8()
	const angularVelocity: [number, number, number] = [r.fixed(true, 8, 7), r.fixed(true, 8, 7), r.fixed(true, 8, 7)]
	const partAccel: [number, number, number] = [r.fixed(true, 8, 7), r.fixed(true, 8, 7), r.fixed(true, 8, 7)]
	const texture = r.uuid()
	const target = r.uuid()
	return { crc, srcFlags, pattern, maxAge, startAge, innerAngle, outerAngle, burstRate, burstRadius, burstSpeedMin, burstSpeedMax, burstPartCount, angularVelocity, partAccel, texture, target }
}

function readPartLegacy(r: Reader): Partial<ParticleSys> {
	const partFlags = r.u32()
	const partMaxAge = r.fixed(false, 8, 8)
	const startColor = r.rgba()
	const endColor = r.rgba()
	const startScale: [number, number] = [r.fixed(false, 3, 5), r.fixed(false, 3, 5)]
	const endScale: [number, number] = [r.fixed(false, 3, 5), r.fixed(false, 3, 5)]
	return { partFlags, partMaxAge, startColor, endColor, startScale, endScale, startGlow: 0, endGlow: 0, blendFuncSource: 7, blendFuncDest: 9 }
}

export function decodeParticleSystem(buf: Buffer, off: number, len: number): ParticleSys | null {
	if (len <= 0 || len > PS_MAX_DATA_BLOCK_SIZE) return null
	if (off + len > buf.length) return null
	const r = new Reader(buf, off, len)
	const legacy = len === PS_LEGACY_DATA_BLOCK_SIZE
	if (!legacy) { const syssize = r.s32(); if (syssize !== PS_SYS_DATA_BLOCK_SIZE) return null }

	const sys = readSystem(r)
	let part: Partial<ParticleSys>
	if (legacy) {
		part = readPartLegacy(r)
	} else {
		r.s32() // partsize (unused; bounds enforced by Reader)
		part = readPartLegacy(r)
		if (((part.partFlags ?? 0) & PS.PART_DATA_GLOW)) { part.startGlow = r.u8() / 255; part.endGlow = r.u8() / 255 }
		if (((part.partFlags ?? 0) & PS.PART_DATA_BLEND)) { part.blendFuncSource = r.u8(); part.blendFuncDest = r.u8() }
	}

	if (!r.ok) return null
	if (!sys.crc) return null
	return { ...sys, ...part } as ParticleSys
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test server/lib/particleCodec.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/lib/particleCodec.ts server/lib/particleCodec.test.ts
git commit -m "feat(particles): decode PSBlock (pure, bounds-checked)"
```

---

## Task 2: Wire decode into the ObjectUpdate codec

**Files:**
- Modify: `server/lib/lludp-codec.ts` (interface ~1041; declare `psys` ~1486; PSBlock site 1536; record push ~1572)
- Test: `server/lib/particleCodec.test.ts` (already covers the decoder; this task is integration — verified by the existing full-suite run)

- [ ] **Step 1: Add the import and interface field**

At the top of `server/lib/lludp-codec.ts` imports, add:

```ts
import { decodeParticleSystem, type ParticleSys } from './particleCodec.ts'
```

In the `ObjectData` interface (around line 1041–1080), add after `text?: string`:

```ts
	psys?: ParticleSys   // particle system (PSBlock) — present only when the object emits particles
```

- [ ] **Step 2: Declare `psys` before the tail `try`**

In `decodeObjectUpdate`, where `textureAnim` etc. are declared (around line 1483–1487), add:

```ts
		let psys: ParticleSys | undefined
```

- [ ] **Step 3: Replace the blind PSBlock skip**

Replace line 1536 (`skipVar1('PSBlock')      // particle system data, ...`) with:

```ts
		// PSBlock (Variable1) — decode the particle system instead of skipping it.
		{
			if (off >= buf.length) throw new Error(`PSBlock prefix OOB at off=${off}`)
			const psLen = buf[off++]
			_diag += ` PSBlock=${psLen}`
			if (off + psLen > buf.length) { off = buf.length; throw new Error(`PSBlock length ${psLen} exceeds buffer`) }
			if (psLen > 0) psys = decodeParticleSystem(buf, off, psLen) ?? undefined
			off += psLen
		}
```

- [ ] **Step 4: Attach `psys` to the pushed record**

In the `objects.push({ ... })` (starting ~1572), add `psys` to the object literal (place near `text`):

```ts
		objects.push({
			localId, fullId, pcode,
			scale: [sx, sy, sz], pos, rot, nameValue,
			// ...existing fields...
			...(psys ? { psys } : {}),
```

(Keep all existing fields; only the `...(psys ? { psys } : {})` spread is new — add it before the closing `})`.)

- [ ] **Step 5: Run the full server suite + typecheck**

Run: `bun test server/` then `npm run build:staging`
Expected: all server tests pass (no new failures vs baseline); build succeeds (TypeScript happy with the new field/import).

- [ ] **Step 6: Commit**

```bash
git add server/lib/lludp-codec.ts
git commit -m "feat(particles): forward decoded psys on obj_upd"
```

---

## Task 3: Live byte-dump diagnostic (verification aid)

**Files:**
- Modify: `server/handlers/lludp.ts` (near the existing PSBlock OOB log, ~638–648)

- [ ] **Step 1: Add an env-gated once-per-localId dump**

In `server/handlers/lludp.ts`, where decoded objects are iterated after `decodeObjectUpdate` returns (find the loop that consumes `decoded.objects`/forwards `S.OBJECT_UPDATE`), add:

```ts
		// DEV: dump raw+decoded particle systems for live layout verification. Off by default.
		if (process.env.PS_BYTE_DUMP === '1' && o.psys) {
			const key = `psdump:${o.localId}`
			if (!session.loggedTypes.has(key)) {
				session.loggedTypes.add(key)
				slog.info(session.ws, `[PSys] localId=${o.localId} pattern=${o.psys.pattern} burst=${o.psys.burstPartCount}@${o.psys.burstRate}s life=${o.psys.partMaxAge} tex=${o.psys.texture ?? '-'} flags=0x${o.psys.partFlags.toString(16)}`)
			}
		}
```

(Match the existing iteration variable name — the handler already loops decoded objects to relay them; reuse that loop and its `o`/object binding. If the handler relays the array wholesale without a per-object loop, add a minimal `for (const o of decoded.objects)` guard around just this dump.)

- [ ] **Step 2: Verify it compiles**

Run: `npm run build:staging`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add server/handlers/lludp.ts
git commit -m "feat(particles): PS_BYTE_DUMP dev diagnostic"
```

---

## Task 4: Document the protocol field

**Files:**
- Modify: `shared/protocol.js` (line ~56, the `OBJECT_UPDATE` comment)

- [ ] **Step 1: Extend the comment**

Change the `OBJECT_UPDATE` line comment to list `psys`:

```js
	OBJECT_UPDATE:'obj_upd',    // { objects: [{ localId, fullId, pcode, pos, rot, scale, nameValue, parentId, shape, defaultColor?, faceColors?, psys? }] }  psys = { pattern, burstRate, burstRadius, burstPartCount, burstSpeedMin/Max, maxAge, startAge, inner/outerAngle, angularVelocity, partAccel, texture, target, partFlags, partMaxAge, start/endColor[rgba], start/endScale[xy], start/endGlow, blendFuncSource/Dest }
```

- [ ] **Step 2: Commit**

```bash
git add shared/protocol.js
git commit -m "docs(protocol): document obj_upd.psys field"
```

---

## Task 5: Client simulation — pure `particleSim.js`

**Files:**
- Create: `src/lib/particleSim.js`
- Test: `src/lib/particleSim.test.js`

**Model:** Structure-of-arrays, swap-remove on death, append-on-spawn (drop if at capacity). All randomness via an injected `rng()` → [0,1) for determinism. Positions are in Three.js world space (the composable converts SL→Three and supplies `srcPos`). Velocities/accel are in source-local space but for v1 we treat the source +Z (SL up) as Three +Y; the composable passes already-converted accel. Keep `particleSim` axis-agnostic: it just integrates whatever vectors it's given.

- [ ] **Step 1: Write the failing test**

```js
// src/lib/particleSim.test.js
import { describe, it, expect } from 'vitest'
import { PSIM, maxLiveParticles, createEmitterState, stepEmitter, sampleAppearance } from './particleSim.js'

const basePsys = {
	pattern: PSIM.PATTERN_DROP, burstRate: 0.1, burstRadius: 0, burstPartCount: 2,
	burstSpeedMin: 1, burstSpeedMax: 1, maxAge: 0, startAge: 0, innerAngle: 0, outerAngle: 0,
	angularVelocity: [0, 0, 0], partAccel: [0, 0, 0],
	partFlags: PSIM.PART_INTERP_COLOR | PSIM.PART_INTERP_SCALE, partMaxAge: 1.0,
	startColor: [1, 0, 0, 1], endColor: [0, 0, 1, 0], startScale: [0.5, 0.5], endScale: [1.5, 1.5],
	startGlow: 0, endGlow: 0, blendFuncSource: 7, blendFuncDest: 9,
}
const rng = () => 0.5

describe('maxLiveParticles', () => {
	it('scales with life/rate*count and clamps to cap', () => {
		expect(maxLiveParticles({ ...basePsys, burstRate: 0.1, partMaxAge: 1, burstPartCount: 2 }, 10000))
			.toBe(Math.ceil(1 / 0.1) * 2 + 2) // 22
		expect(maxLiveParticles({ ...basePsys, burstRate: 0.01, partMaxAge: 30, burstPartCount: 100 }, 512)).toBe(512)
	})
})

describe('stepEmitter', () => {
	it('spawns one burst per burstRate elapsed', () => {
		const st = createEmitterState(basePsys, 64)
		stepEmitter(st, basePsys, 0.25, [0, 0, 0], null, rng) // 0.25s / 0.1 = 2 bursts
		expect(st.count).toBe(4) // 2 bursts × 2 particles
	})

	it('DROP pattern gives ~zero initial velocity', () => {
		const st = createEmitterState(basePsys, 64)
		stepEmitter(st, basePsys, 0.1, [0, 0, 0], null, rng)
		expect(Math.hypot(st.vx[0], st.vy[0], st.vz[0])).toBeLessThan(1e-6)
	})

	it('EXPLODE pattern gives speed within [min,max]', () => {
		const ps = { ...basePsys, pattern: PSIM.PATTERN_EXPLODE, burstSpeedMin: 2, burstSpeedMax: 4 }
		const st = createEmitterState(ps, 64)
		stepEmitter(st, ps, 0.1, [0, 0, 0], null, rng)
		const spd = Math.hypot(st.vx[0], st.vy[0], st.vz[0])
		expect(spd).toBeGreaterThanOrEqual(2 - 1e-3)
		expect(spd).toBeLessThanOrEqual(4 + 1e-3)
	})

	it('retires particles past partMaxAge and never exceeds capacity', () => {
		const ps = { ...basePsys, burstRate: 0.01, burstPartCount: 50, partMaxAge: 0.5 }
		const st = createEmitterState(ps, 16)
		let maxSeen = 0, minSeen = Infinity
		for (let i = 0; i < 20; i++) {
			stepEmitter(st, ps, 0.1, [0, 0, 0], null, rng)
			expect(st.count).toBeLessThanOrEqual(16)   // cap invariant holds EVERY step
			maxSeen = Math.max(maxSeen, st.count)
			minSeen = Math.min(minSeen, st.count)
		}
		expect(maxSeen).toBe(16)   // filled to capacity (spawn + clamp)
		expect(minSeen).toBe(0)    // fully retired at least once (retirement works)
	})

	it('applies partAccel and source position offset', () => {
		const ps = { ...basePsys, partAccel: [0, -10, 0] }
		const st = createEmitterState(ps, 64)
		stepEmitter(st, ps, 0.1, [5, 0, 0], null, rng)
		expect(st.px[0]).toBeCloseTo(5, 1)         // spawned at source
		expect(st.vy[0]).toBeCloseTo(-10 * 0.1, 3) // gained accel·dt
	})
})

describe('sampleAppearance', () => {
	it('interpolates color/alpha/scale across normalized age', () => {
		const a0 = sampleAppearance(basePsys, 0)
		expect(a0.color).toEqual([1, 0, 0]); expect(a0.alpha).toBe(1); expect(a0.scale).toBeCloseTo(0.5, 3)
		const a1 = sampleAppearance(basePsys, 1)
		expect(a1.color[2]).toBeCloseTo(1, 3); expect(a1.alpha).toBeCloseTo(0, 3); expect(a1.scale).toBeCloseTo(1.5, 3)
	})
	it('holds start values when interp flags are off', () => {
		const ps = { ...basePsys, partFlags: 0 }
		const a = sampleAppearance(ps, 1)
		expect(a.color).toEqual([1, 0, 0]); expect(a.alpha).toBe(1); expect(a.scale).toBeCloseTo(0.5, 3)
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/particleSim.test.js`
Expected: FAIL — cannot import `./particleSim.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/lib/particleSim.js
// Pure, Three.js-free particle simulation over structure-of-arrays buffers.
// Mirrors SL semantics (llpartdata) for the v1 common-case subset.

export const PSIM = {
	PATTERN_DROP: 0x01, PATTERN_EXPLODE: 0x02, PATTERN_ANGLE: 0x04,
	PATTERN_ANGLE_CONE: 0x08, PATTERN_ANGLE_CONE_EMPTY: 0x10,
	PART_INTERP_COLOR: 0x01, PART_INTERP_SCALE: 0x02,
	PART_FOLLOW_SRC: 0x10, PART_FOLLOW_VELOCITY: 0x20,
	PART_EMISSIVE: 0x100, PART_DATA_GLOW: 0x10000, PART_DATA_BLEND: 0x20000,
	SRC_USE_NEW_ANGLE: 0x02,   // LLPartSysData.mFlags (srcFlags): particle uses 'correct' angle params
}

// Upper bound on simultaneously-live particles for this source, clamped to `cap`.
export function maxLiveParticles(psys, cap) {
	const rate = Math.max(0.01, psys.burstRate)
	const life = Math.max(0.01, psys.partMaxAge)
	const count = Math.max(1, psys.burstPartCount | 0)
	return Math.min(cap, Math.ceil(life / rate) * count + count)
}

export function createEmitterState(psys, capacity) {
	return {
		capacity, count: 0, emitAccum: 0, sourceAge: 0,
		px: new Float32Array(capacity), py: new Float32Array(capacity), pz: new Float32Array(capacity),
		vx: new Float32Array(capacity), vy: new Float32Array(capacity), vz: new Float32Array(capacity),
		age: new Float32Array(capacity), life: new Float32Array(capacity),
	}
}

// Emission UNIT direction in SL axes (Z-up), replicating Firestorm
// llviewerpartsource.cpp LLViewerPartSourceScript::update spawn block. Returns null for
// DROP (particle stays at the source with zero velocity). srcRot (SL quaternion [x,y,z,w])
// is applied to the direction afterwards in spawn().
function emitDirection(psys, rng) {
	switch (psys.pattern) {
		case PSIM.PATTERN_DROP:
			return null
		case PSIM.PATTERN_EXPLODE: {
			// FS: uniform-on-sphere via rejection sampling of the unit cube. Guarded against a
			// degenerate run (e.g. a constant rng) so it can't loop forever.
			for (let g = 0; g < 16; g++) {
				const x = rng() * 2 - 1, y = rng() * 2 - 1, z = rng() * 2 - 1
				const m = x * x + y * y + z * z
				if (m <= 1 && m >= 0.01) { const inv = 1 / Math.sqrt(m); return [x * inv, y * inv, z * inv] }
			}
			return [0, 0, 1]
		}
		case PSIM.PATTERN_ANGLE:
		case PSIM.PATTERN_ANGLE_CONE: {
			let d = [0, 0, 1]
			let angle = psys.innerAngle + (psys.outerAngle - psys.innerAngle) * rng()
			if (rng() < 0.5) angle = -angle
			d = rotAxis(d, [1, 0, 0], angle)                                  // rotate around X
			if (psys.pattern & PSIM.PATTERN_ANGLE_CONE) d = rotAxis(d, [0, 0, 1], rng() * 4 * Math.PI)
			if (!(psys.srcFlags & PSIM.SRC_USE_NEW_ANGLE)) d = rotAxis(d, [1, 0, 0], psys.outerAngle) // legacy
			return d
		}
		// DROP, ANGLE_CONE_EMPTY (0x10), unknown → stationary. Matches FS: `pattern & (ANGLE|ANGLE_CONE)`
		// excludes 0x10, so FS falls to its zero-velocity default for ANGLE_CONE_EMPTY.
		default:
			return null
	}
}

// Rotate vector v around unit axis a by angle (radians) — Rodrigues' formula.
function rotAxis(v, a, ang) {
	const c = Math.cos(ang), s = Math.sin(ang), k = 1 - c
	const dot = v[0] * a[0] + v[1] * a[1] + v[2] * a[2]
	const cx = a[1] * v[2] - a[2] * v[1], cy = a[2] * v[0] - a[0] * v[2], cz = a[0] * v[1] - a[1] * v[0]
	return [v[0] * c + cx * s + a[0] * dot * k, v[1] * c + cy * s + a[1] * dot * k, v[2] * c + cz * s + a[2] * dot * k]
}

// Rotate vector v by quaternion q=[x,y,z,w].
function rotQuat(v, q) {
	const x = q[0], y = q[1], z = q[2], w = q[3]
	const ix = w * v[0] + y * v[2] - z * v[1]
	const iy = w * v[1] + z * v[0] - x * v[2]
	const iz = w * v[2] + x * v[1] - y * v[0]
	const iw = -x * v[0] - y * v[1] - z * v[2]
	return [
		ix * w + iw * -x + iy * -z - iz * -y,
		iy * w + iw * -y + iz * -x - ix * -z,
		iz * w + iw * -z + ix * -y - iy * -x,
	]
}

// Spawn one particle. All vectors in SL axes (Z-up). srcRot optional ([x,y,z,w] or null).
// FS places the burst-radius offset ALONG the emission direction (not a random sphere).
function spawn(st, psys, srcPos, srcRot, rng) {
	if (st.count >= st.capacity) return
	const i = st.count++
	const dir = emitDirection(psys, rng)
	let vx = 0, vy = 0, vz = 0, ox = 0, oy = 0, oz = 0
	if (dir) {
		// FS applies the source rotation to ANGLE/ANGLE_CONE only; EXPLODE is isotropic world-space.
		const isAngle = psys.pattern === PSIM.PATTERN_ANGLE || psys.pattern === PSIM.PATTERN_ANGLE_CONE
		const d = (srcRot && isAngle) ? rotQuat(dir, srcRot) : dir
		const speed = psys.burstSpeedMin + (psys.burstSpeedMax - psys.burstSpeedMin) * rng()
		ox = d[0] * psys.burstRadius; oy = d[1] * psys.burstRadius; oz = d[2] * psys.burstRadius
		vx = d[0] * speed; vy = d[1] * speed; vz = d[2] * speed
	}
	st.px[i] = srcPos[0] + ox; st.py[i] = srcPos[1] + oy; st.pz[i] = srcPos[2] + oz
	st.vx[i] = vx; st.vy[i] = vy; st.vz[i] = vz
	st.age[i] = 0; st.life[i] = Math.max(0.01, psys.partMaxAge)
}

// Advance dt seconds: emit due bursts, integrate, retire (swap-remove). All vectors in SL
// axes (Z-up); the composable converts final positions SL→Three at buffer-write. srcPos =
// source SL position [x,y,z]; srcRot = source SL rotation [x,y,z,w] or null.
export function stepEmitter(st, psys, dt, srcPos, srcRot, rng) {
	const rate = Math.max(0.01, psys.burstRate)
	st.emitAccum += dt
	let guard = 0
	while (st.emitAccum >= rate && guard++ < 64) {
		st.emitAccum -= rate
		const n = Math.max(1, psys.burstPartCount | 0)
		for (let k = 0; k < n; k++) spawn(st, psys, srcPos, srcRot, rng)
	}
	const ax = psys.partAccel[0], ay = psys.partAccel[1], az = psys.partAccel[2]
	for (let i = 0; i < st.count; ) {
		st.age[i] += dt
		if (st.age[i] >= st.life[i]) {
			const last = --st.count
			st.px[i] = st.px[last]; st.py[i] = st.py[last]; st.pz[i] = st.pz[last]
			st.vx[i] = st.vx[last]; st.vy[i] = st.vy[last]; st.vz[i] = st.vz[last]
			st.age[i] = st.age[last]; st.life[i] = st.life[last]
			continue
		}
		st.vx[i] += ax * dt; st.vy[i] += ay * dt; st.vz[i] += az * dt
		st.px[i] += st.vx[i] * dt; st.py[i] += st.vy[i] * dt; st.pz[i] += st.vz[i] * dt
		i++
	}
}

// Color (rgb), alpha, scale at normalized age f∈[0,1], honoring interp flags.
export function sampleAppearance(psys, f) {
	const ic = (psys.partFlags & PSIM.PART_INTERP_COLOR) !== 0
	const is = (psys.partFlags & PSIM.PART_INTERP_SCALE) !== 0
	const sc = psys.startColor, ec = psys.endColor
	const color = ic ? [sc[0] + (ec[0] - sc[0]) * f, sc[1] + (ec[1] - sc[1]) * f, sc[2] + (ec[2] - sc[2]) * f] : [sc[0], sc[1], sc[2]]
	const alpha = ic ? sc[3] + (ec[3] - sc[3]) * f : sc[3]
	const s0 = psys.startScale[0], s1 = psys.endScale[0]
	const scale = is ? s0 + (s1 - s0) * f : s0
	return { color, alpha, scale }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/particleSim.test.js`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/particleSim.js src/lib/particleSim.test.js
git commit -m "feat(particles): pure client simulation lib"
```

---

## Task 6: Client composable — `useParticles.js`

**Files:**
- Create: `src/composables/useParticles.js`

**Responsibilities:** singleton scene-attached manager; one `THREE.Points` per emitter with a custom `ShaderMaterial` (per-particle color, alpha, size; texture map; blend mode); global + per-emitter caps; distance cull; heap-awareness; runtime radial-sprite fallback; texture resolution via the existing cache.

**Dependencies:** `three`, `./particleSim.js`, `./useTextureFetch.js` (`getTexture`), `../lib/memGovernor.js` (`memUnderPressure`), `@/config/configuration.js` if needed for caps.

**SL→Three axis note:** the simulation runs entirely in **SL axes (Z-up)** to match Firestorm's spawn math exactly (Task 5). The composable receives the source's live SL position + rotation via the `getSrc` callback (`{ pos:[x,y,z], rot:[x,y,z,w] }`), simulates in SL space, and converts each particle's **position** SL→Three only at buffer-write time: `(x,y,z)_SL → (x, z, -y)_Three` (the project's `slToThree` convention, inverse of the `[tx,-tz,ty]` Three→SL mapping in `useWorldEngine`). The cull distance converts the source SL pos to Three once per emitter. No per-field accel conversion is needed.

- [ ] **Step 1: Implement the composable**

```js
// src/composables/useParticles.js
import * as THREE from 'three'
import { PSIM, maxLiveParticles, createEmitterState, stepEmitter, sampleAppearance } from '../lib/particleSim.js'
import { getTexture } from './useTextureFetch.js'
import { memUnderPressure } from '../lib/memGovernor.js'

const GLOBAL_PARTICLE_CAP = 20000
const PER_EMITTER_CAP = 512
const CULL_DIST = 96           // metres; emitters beyond this freeze (no spawn/integrate)
const CULL_DIST_SQ = CULL_DIST * CULL_DIST

let _fallbackTex = null
function fallbackTexture() {
	if (_fallbackTex) return _fallbackTex
	const s = 64, c = document.createElement('canvas'); c.width = c.height = s
	const g = c.getContext('2d')
	const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
	grad.addColorStop(0, 'rgba(255,255,255,1)')
	grad.addColorStop(0.5, 'rgba(255,255,255,0.6)')
	grad.addColorStop(1, 'rgba(255,255,255,0)')
	g.fillStyle = grad; g.fillRect(0, 0, s, s)
	_fallbackTex = new THREE.CanvasTexture(c)
	_fallbackTex.colorSpace = THREE.SRGBColorSpace
	return _fallbackTex
}

const VERT = `
	attribute vec3 pcolor; attribute float palpha; attribute float psize;
	varying vec3 vColor; varying float vAlpha;
	void main() {
		vColor = pcolor; vAlpha = palpha;
		vec4 mv = modelViewMatrix * vec4(position, 1.0);
		gl_PointSize = psize * (300.0 / -mv.z);
		gl_Position = projectionMatrix * mv;
	}`
const FRAG = `
	uniform sampler2D map; varying vec3 vColor; varying float vAlpha;
	void main() {
		vec4 t = texture2D(map, gl_PointCoord);
		float a = t.a * vAlpha;
		if (a < 0.01) discard;
		gl_FragColor = vec4(vColor * t.rgb, a);
	}`

function makeMaterial(psys) {
	const additive = (psys.partFlags & PSIM.PART_EMISSIVE) !== 0 || psys.startGlow > 0 || psys.endGlow > 0
	return new THREE.ShaderMaterial({
		uniforms: { map: { value: fallbackTexture() } },
		vertexShader: VERT, fragmentShader: FRAG,
		transparent: true, depthWrite: false,
		blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
	})
}

export function useParticles(scene) {
	const emitters = new Map()   // localId → { psys, state, points, geo, mat, getSrcPos, colA, alpA, sizA }
	let liveTotal = 0

	function register(localId, psys, getSrc) {
		unregister(localId)
		if (!psys || !getSrc) return
		const cap = maxLiveParticles(psys, PER_EMITTER_CAP)
		const state = createEmitterState(psys, cap)
		const geo = new THREE.BufferGeometry()
		const posA = new Float32Array(cap * 3)
		const colA = new Float32Array(cap * 3)
		const alpA = new Float32Array(cap)
		const sizA = new Float32Array(cap)
		geo.setAttribute('position', new THREE.BufferAttribute(posA, 3))
		geo.setAttribute('pcolor', new THREE.BufferAttribute(colA, 3))
		geo.setAttribute('palpha', new THREE.BufferAttribute(alpA, 1))
		geo.setAttribute('psize', new THREE.BufferAttribute(sizA, 1))
		geo.setDrawRange(0, 0)
		const mat = makeMaterial(psys)
		const points = new THREE.Points(geo, mat)
		points.frustumCulled = false
		scene.add(points)
		emitters.set(localId, { psys, state, points, geo, mat, getSrc, colA, alpA, sizA })
		if (psys.texture) {
			getTexture(psys.texture).then(t => { if (t && emitters.get(localId)?.mat === mat) { mat.uniforms.map.value = t; mat.needsUpdate = true } }).catch(() => {})
		}
	}

	function unregister(localId) {
		const e = emitters.get(localId); if (!e) return
		scene.remove(e.points); e.geo.dispose(); e.mat.dispose()
		liveTotal -= e.state.count
		emitters.delete(localId)
	}

	function step(dt, camPos) {
		if (dt <= 0) return
		const paused = memUnderPressure?.() === true
		liveTotal = 0
		for (const e of emitters.values()) {
			const src = e.getSrc()
			if (!src || !src.pos) { e.geo.setDrawRange(0, 0); continue }
			// cull on the source position converted SL→Three: (x,y,z)→(x,z,-y)
			const tx = src.pos[0], ty = src.pos[2], tz = -src.pos[1]
			const dx = tx - camPos.x, dy = ty - camPos.y, dz = tz - camPos.z
			const far = dx * dx + dy * dy + dz * dz > CULL_DIST_SQ
			if (!far && !paused && liveTotal < GLOBAL_PARTICLE_CAP) {
				stepEmitter(e.state, e.psys, Math.min(dt, 0.1), src.pos, src.rot || null, Math.random)
			}
			const st = e.state, n = st.count
			const posA = e.geo.attributes.position.array
			for (let i = 0; i < n; i++) {
				const f = st.age[i] / st.life[i]
				const a = sampleAppearance(e.psys, f)
				// SL→Three: (px,py,pz)_SL → (px, pz, -py)_Three
				posA[i * 3] = st.px[i]; posA[i * 3 + 1] = st.pz[i]; posA[i * 3 + 2] = -st.py[i]
				e.colA[i * 3] = a.color[0]; e.colA[i * 3 + 1] = a.color[1]; e.colA[i * 3 + 2] = a.color[2]
				e.alpA[i] = a.alpha; e.sizA[i] = Math.max(0.02, a.scale)
			}
			e.geo.setDrawRange(0, n)
			e.geo.attributes.position.needsUpdate = true
			e.geo.attributes.pcolor.needsUpdate = true
			e.geo.attributes.palpha.needsUpdate = true
			e.geo.attributes.psize.needsUpdate = true
			liveTotal += n
		}
	}

	function stats() { return { emitters: emitters.size, live: liveTotal } }
	function dispose() { for (const id of [...emitters.keys()]) unregister(id) }

	return { register, unregister, step, stats, dispose }
}
```

- [ ] **Step 2: Verify it builds (no test yet — Three/DOM heavy; covered by sim tests + live-verify)**

Run: `npm run build:staging`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/composables/useParticles.js
git commit -m "feat(particles): emitter pool composable (Points + caps + cull)"
```

---

## Task 7: Wire emitters into the engine

**Files:**
- Modify: `src/composables/useWorldEngine.js` (import + init ~21/scene setup; `upsertMesh` mesh-create ~2033; `removeMesh` ~2403; `animate` ~4279/pump block ~4498–4516; clearAll/region-clear path)

**Axis conversion:** the engine has `slToThree`/`PCODE_AVATAR` etc. For a source object the world position in Three coords is `mesh.position` (already SL→Three converted at upsert). Pass `() => mesh.position.toArray()` as `getSrcPos`. Particle accel arrives in SL axes `[x,y,z]`; convert once at register to Three `[x, z, y]` so gravity (SL −Z) becomes Three −Y.

- [ ] **Step 1: Import and instantiate**

Near the other composable imports (~line 21) add:

```js
import { useParticles } from './useParticles.js'
```

Where the scene is created (search `new THREE.Scene()`), after the scene exists, add:

```js
	const particles = useParticles(scene)
```

- [ ] **Step 2: Register on mesh create / update**

In `upsertMesh`, after the mesh is created and added to the scene (right after `mesh.onBeforeRender = _noteDraw`, ~line 2033), add:

```js
		// Particle system: (re)register an emitter when the object carries psys. The sim runs
		// in SL space, so feed it the LIVE SL pos/rot from worldStore (TerseUpdates keep pos
		// current); the composable converts particle positions SL→Three at draw time.
		if (obj.psys) {
			const lid = obj.localId
			particles.register(lid, obj.psys, () => {
				const o = worldStore.objects.get(lid)
				return o && o.pos ? { pos: o.pos, rot: o.rot || [0, 0, 0, 1] } : null
			})
		} else {
			particles.unregister(obj.localId)
		}
```

(If `upsertMesh` distinguishes new vs update, place this so it runs on BOTH paths — psys can arrive on a later update. The `register` call already unregisters first, so calling it on every upsert with psys is safe and idempotent. No accel conversion: the sim is SL-space.)

- [ ] **Step 3: Unregister on remove**

In `removeMesh(localId)` (~line 2403), at the top of the function body, add:

```js
		particles.unregister(localId)
```

Also find the full-scene clear (search `clearAll`/region-reset that loops `removeMesh` or empties `meshMap`) and add `particles.dispose()` there.

- [ ] **Step 4: Drive the simulation from animate()**

In `animate(time)`, near the existing pump calls (~line 4498–4516, where `pumpTextureBuilds` runs), add a dt computation and the step. At the top of `animate` add (once):

```js
		const _now = time || 0
		const _pdt = _lastParticleT ? (_now - _lastParticleT) / 1000 : 0
		_lastParticleT = _now
```

and declare `let _lastParticleT = 0` alongside the other animate-scope module state (near `_lastDrawMesh`). Then in the pump block:

```js
		particles.step(_pdt, camera.position)
```

- [ ] **Step 5: Telemetry**

Where the `[Drain]`/`[Mem]` telemetry line is assembled (search `[Drain]`), append the particle counts. Add to that log string:

```js
		` ps=${particles.stats().emitters}/${particles.stats().live}`
```

(or, if telemetry is rate-limited, fold `particles.stats()` into the existing stats object — match the surrounding pattern).

- [ ] **Step 6: Verify build + full test suite**

Run: `npm run build:staging && npx vitest run`
Expected: build succeeds; vitest shows no new failures vs baseline (the new `particleSim` tests pass; nothing else regresses).

- [ ] **Step 7: Commit**

```bash
git add src/composables/useWorldEngine.js
git commit -m "feat(particles): wire emitters into world engine + animate"
```

---

## Task 8: Live verification

**No code — manual, with the dev driving the client (per the "own Bun, watch logs myself" rule).**

- [ ] **Step 1:** Restart the Bun server with the diagnostic on: `PS_BYTE_DUMP=1` in the dev env (or export before `npm run dev:server`). Confirm `[PSys] localId=… pattern=… burst=…` lines appear when flying near a known emitter (fountain/fire).
- [ ] **Step 2:** In the client, fly to a region with particle emitters. Confirm: particles render, follow their source, fade/scale over life, and additive (fire/glow) vs alpha (smoke) blend looks right. Check the `[Drain]` line shows `ps=N/M` rising near emitters and dropping to `0/0` when far (cull works).
- [ ] **Step 3:** Stress: a dense particle region + a heavy mesh region. Confirm no heap regression (`[Mem]` heap stays in its normal band), no fps cliff, and that `ps` live count respects the global cap (~20k).
- [ ] **Step 4:** Turn the diagnostic off (`PS_BYTE_DUMP` unset). Update `docs/FEATURE-GAPS.md` line 133 (Particle systems) → `[~]` implemented (uncommitted/needs-live-verify or done per result). Note the `ObjectUpdateCompressed` particle path as the remaining follow-up.

---

## Follow-up (future phases, NOT this plan)

1. ~~**`ObjectUpdateCompressed` particle path**~~ — ✅ **DONE 2026-06-21** (committed). The compressed decoder previously marked `0x08 HasParticlesLegacy` / `0x400 HasParticlesNew` prims as `RARE` and bailed the whole conditional zone, so they got no `psys` AND no TextureEntry → pastel-plane with no particles. Fixed per OpenSim `LLClientView.CreateCompressedUpdateBlockZC`: narrowed `RARE` to `0x01|0x02`; decode legacy as a fixed **86 B** block between MediaURL and ExtraParams (exact consume keeps the following TE aligned), and new (self-describing) right after TE+TexAnim; `psys` emitted from the compressed path. Each object is Variable2-length-framed (`off = dataEnd` resets), so a mis-parse can't cascade across objects. Tests: `server/__tests__/compressed-particles.test.ts` + server suite 174/0 (real fixtures unchanged). Paired with retiring the pre-real-data pastel fallback → white in `useWorldEngine.js`.
2. **Particle authoring suite (Firestorm parity)** — the Editor/Inject/Explorer/Rip tools you flagged live in FS `indra/newview/particleeditor.{cpp,h}`. These *create/edit/copy/inject* particle systems (FS emits an LSL script applied to an object), which requires an outbound authoring path — a distinct, larger feature than v1 rendering. Sequence it after rendering lands. Its save/load uses the `asLLSD`/`fromLLSD` helpers that are the only FS-vs-LL delta in `llpartdata.cpp`.
3. **Deferred sim flags** — target-follow/beam/ribbon, wind coupling, bounce (per the spec non-goals).

## Self-Review (completed during authoring)

- **Spec coverage:** decode (T1–2), forward (T2, T4), worldStore passthrough (generic `upsertObject` already stores arbitrary fields — verified in explorer report `worldStore.js:57-65`; no task needed), simulation (T5), rendering+material+texture+fallback (T6), engine wiring + animate + telemetry (T7), perf caps/cull/heap (T6 constants + T7 step), tests (T1,T5), live-verify (T8). All spec sections map to a task.
- **Placeholder scan:** no TBDs; every code step has complete code; fixtures are concrete (synthetic byte builders), offsets are locked from `llpartdata.cpp`.
- **Type consistency:** `decodeParticleSystem`/`ParticleSys` (T1) used verbatim in T2; `psys` field name consistent T2→T4→T7; `PSIM`/`createEmitterState`/`stepEmitter`/`sampleAppearance`/`maxLiveParticles` names consistent T5→T6; `register`/`unregister`/`step`/`stats`/`dispose` consistent T6→T7. Flag constant values match `llpartdata.h` (GLOW=0x10000, BLEND=0x20000, EMISSIVE=0x100, patterns 0x01–0x10).
- **Refinement noted:** runtime radial-sprite fallback replaces the spec's "bundled WebP" (simpler, no binary asset, never 404s). `ObjectUpdateCompressed` particle decode scoped out of v1 (full-ObjectUpdate path only) — recorded in T8.
