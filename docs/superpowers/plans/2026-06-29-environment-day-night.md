# Environment & Day/Night System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A region-driven day/night cycle — gradient sky, moving sun, and a global exposure ramp that visibly carries the whole world through dawn→noon→dusk→night, with a local fallback and a manual override.

**Architecture:** Server decodes `SimulatorViewerTimeMessage` (Low 150) and relays it as `S.ENVIRONMENT_TIME`. A single client composable `useEnvironment.js` holds time-of-day state, extrapolates the sun between sparse server samples, and maps sun elevation to a keyframed palette (sun/ambient/sky/fog colors + exposure). `useWorldEngine.animate()` and a `SkyDome` consume that palette each frame; clouds, terrain textures, trees, and prefs hang off the same state.

**Tech Stack:** TypeScript (Bun server), Vue 3 `<script setup>` + Pinia, Three.js, vitest. Spec: `docs/superpowers/specs/2026-06-29-environment-day-night-design.md`.

## Global Constraints

- Tabs, not spaces (`.editorconfig`). `rem` for sizing; `px` allowed for borders only.
- Import paths: `@/` → `src/`, `@shared/` → `shared/`. Config via `import { config } from '@/config/configuration.js'`.
- Server edits hot-restart Bun and DROP the circuit — do ALL server tasks (1–2) in one burst, restart once, then client tasks over Vite HMR.
- Coordinate frame: `slToThree(x,y,z) => new THREE.Vector3(x, z, -y)` (`useWorldEngine.js:53`). SL is Z-up; sun elevation = SL `z` component.
- Tone-mapping baseline: `LinearToneMapping`, `toneMappingExposure` clamped `[0.22, 1.0]` (1.0 = daytime identity, never exceeded).
- OpenSim default day length = `14400` seconds (fallback when no time message arrives).
- Lint is known-broken repo-wide (ESLint 9 flat-config); verify via `npx vitest run` + `npm run build:staging`.
- No commented-out code; `// WHY:` for non-obvious logic. Do not auto-commit — leave commits to the user (steps below stage+message; the user runs them, or the executing skill commits per its own rules).

---

### Task 1: Server — decode `SimulatorViewerTimeMessage` (Low 150)

**Files:**
- Modify: `server/lib/lludp-codec.ts` (add `decodeSimulatorViewerTime`, follow the `decodeRegionHandshake` pattern at line 1718)
- Test: `server/__tests__/lludp-codec.simviewertime.test.ts` (Create)

**Interfaces:**
- Produces: `decodeSimulatorViewerTime(buf: Buffer, dataOffset: number): SimulatorViewerTimeData`
  where `interface SimulatorViewerTimeData { usecSinceStart: number; secPerDay: number; secPerYear: number; sunDirection: [number, number, number]; sunPhase: number; sunAngVelocity: [number, number, number] }`
- Field layout (verbatim from `server/lib/protocol/message_template.msg:3438`): `UsecSinceStart` U64, `SecPerDay` U32, `SecPerYear` U32, `SunDirection` LLVector3 (3×F32 LE), `SunPhase` F32, `SunAngVelocity` LLVector3.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { decodeSimulatorViewerTime } from '../lib/lludp-codec'

describe('decodeSimulatorViewerTime', () => {
	it('decodes Low 150 fields in order', () => {
		const buf = Buffer.alloc(8 + 4 + 4 + 12 + 4 + 12)
		let o = 0
		buf.writeBigUInt64LE(123456789n, o); o += 8
		buf.writeUInt32LE(14400, o); o += 4          // secPerDay
		buf.writeUInt32LE(31536000, o); o += 4       // secPerYear
		buf.writeFloatLE(0.0, o); o += 4             // sunDir x
		buf.writeFloatLE(0.0, o); o += 4             // sunDir y
		buf.writeFloatLE(1.0, o); o += 4             // sunDir z (zenith)
		buf.writeFloatLE(0.25, o); o += 4            // sunPhase
		buf.writeFloatLE(0.0, o); o += 4
		buf.writeFloatLE(0.0, o); o += 4
		buf.writeFloatLE(0.001, o); o += 4           // sunAngVel z

		const r = decodeSimulatorViewerTime(buf, 0)
		expect(r.secPerDay).toBe(14400)
		expect(r.secPerYear).toBe(31536000)
		expect(r.sunDirection).toEqual([0, 0, 1])
		expect(r.sunPhase).toBeCloseTo(0.25)
		expect(r.sunAngVelocity[2]).toBeCloseTo(0.001)
		expect(r.usecSinceStart).toBe(123456789)
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/lludp-codec.simviewertime.test.ts`
Expected: FAIL — `decodeSimulatorViewerTime is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to `server/lib/lludp-codec.ts` (near the other decoders, mirroring `decodeRegionHandshake`'s buffer-cursor style):

```ts
export interface SimulatorViewerTimeData {
	usecSinceStart: number
	secPerDay: number
	secPerYear: number
	sunDirection: [number, number, number]
	sunPhase: number
	sunAngVelocity: [number, number, number]
}

export function decodeSimulatorViewerTime(buf: Buffer, dataOffset: number): SimulatorViewerTimeData {
	let o = dataOffset
	const usecSinceStart = Number(buf.readBigUInt64LE(o)); o += 8
	const secPerDay = buf.readUInt32LE(o); o += 4
	const secPerYear = buf.readUInt32LE(o); o += 4
	const sd: [number, number, number] = [buf.readFloatLE(o), buf.readFloatLE(o + 4), buf.readFloatLE(o + 8)]; o += 12
	const sunPhase = buf.readFloatLE(o); o += 4
	const sav: [number, number, number] = [buf.readFloatLE(o), buf.readFloatLE(o + 4), buf.readFloatLE(o + 8)]; o += 12
	return { usecSinceStart, secPerDay, secPerYear, sunDirection: sd, sunPhase, sunAngVelocity: sav }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/__tests__/lludp-codec.simviewertime.test.ts`
Expected: PASS.

- [ ] **Step 5: Stage**

```bash
git add server/lib/lludp-codec.ts server/__tests__/lludp-codec.simviewertime.test.ts
```
Commit message: `feat(env): decode SimulatorViewerTimeMessage`

---

### Task 2: Server — relay `S.ENVIRONMENT_TIME` to the client

**Files:**
- Modify: `shared/protocol.js` (add `ENVIRONMENT_TIME` to the server→client `S` enum, following the existing entries e.g. `TERRAIN_PATCH`)
- Modify: `server/handlers/lludp.ts` (register Low 150 alongside the other Low decoders ~L10–62; on receipt, decode + relay)

**Interfaces:**
- Consumes: `decodeSimulatorViewerTime` (Task 1).
- Produces: client receives `{ type: S.ENVIRONMENT_TIME, sunDirection, sunPhase, sunAngVelocity, secPerDay, usecSinceStart }`.

- [ ] **Step 1: Add the message id**

In `shared/protocol.js`, in the `S` (server→client) block, add:

```js
	ENVIRONMENT_TIME: 'environment_time', // { sunDirection:[x,y,z], sunPhase, sunAngVelocity:[x,y,z], secPerDay, usecSinceStart } — from SimulatorViewerTimeMessage (Low 150)
```

- [ ] **Step 2: Wire the handler**

In `server/handlers/lludp.ts`, import `decodeSimulatorViewerTime` and `S`, register Low 150 the same way RegionHandshake (Low 148) is handled, and relay:

```ts
// Low 150 — SimulatorViewerTimeMessage → forward sun/time to client
const t = decodeSimulatorViewerTime(buf, dataOffset)
send(ws, { type: S.ENVIRONMENT_TIME, sunDirection: t.sunDirection, sunPhase: t.sunPhase,
	sunAngVelocity: t.sunAngVelocity, secPerDay: t.secPerDay, usecSinceStart: t.usecSinceStart })
```

(Match the actual `send`/dispatch helper and the Low-number switch/table already used in this file — copy the RegionHandshake case's shape.)

- [ ] **Step 3: Restart Bun once and verify relay**

This is the single server restart for the whole chunk. After it, watch the server log on a live connect for an `environment_time` send (or add a one-line `dbg` in the handler). Tell the user: "server settled — reconnect."
Expected: on entering a region, at least one `ENVIRONMENT_TIME` relayed.

- [ ] **Step 4: Stage**

```bash
git add shared/protocol.js server/handlers/lludp.ts
```
Commit message: `feat(env): relay ENVIRONMENT_TIME to client`

---

### Task 3: Client — pure env math + palette (`src/lib/environment.js`)

**Files:**
- Create: `src/lib/environment.js`
- Test: `src/lib/__tests__/environment.test.js` (Create)

**Interfaces:**
- Produces:
  - `elevationFromSunDir(dir: [number,number,number]): number` — returns SL up-component (`dir[2]`), clamped `[-1,1]`.
  - `dayPhaseFromElevation(elev: number): number` — maps `elev∈[-1,1]` → `phase∈[0,1]` (0 = deep night, 0.5 = horizon, 1 = high noon).
  - `samplePalette(phase: number): EnvPalette` where
    `EnvPalette = { skyZenith:number, skyHorizon:number, ambient:number, sunColor:number, sunIntensity:number, fog:number, exposure:number, starOpacity:number }` (colors are `0xRRGGBB` ints).
  - `PALETTE` keyframe table (exported for tuning).

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest'
import { elevationFromSunDir, dayPhaseFromElevation, samplePalette } from '../environment.js'

describe('environment math', () => {
	it('elevation is the SL up-component, clamped', () => {
		expect(elevationFromSunDir([0, 0, 1])).toBeCloseTo(1)
		expect(elevationFromSunDir([1, 0, 0])).toBeCloseTo(0)
		expect(elevationFromSunDir([0, 0, -5])).toBeCloseTo(-1)
	})
	it('dayPhase: noon→1, horizon→~0.5, deep night→0', () => {
		expect(dayPhaseFromElevation(1)).toBeCloseTo(1, 1)
		expect(dayPhaseFromElevation(0)).toBeGreaterThan(0.4)
		expect(dayPhaseFromElevation(0)).toBeLessThan(0.6)
		expect(dayPhaseFromElevation(-1)).toBeCloseTo(0, 1)
	})
	it('palette endpoints: night is dark+dim, day is bright+exposure 1', () => {
		const night = samplePalette(0)
		const day = samplePalette(1)
		expect(night.exposure).toBeLessThan(0.3)
		expect(night.starOpacity).toBeGreaterThan(0.8)
		expect(day.exposure).toBeCloseTo(1)
		expect(day.starOpacity).toBeCloseTo(0)
		expect(day.sunIntensity).toBeGreaterThan(night.sunIntensity)
	})
	it('exposure never exceeds 1 across the whole range', () => {
		for (let p = 0; p <= 1.0001; p += 0.05) expect(samplePalette(p).exposure).toBeLessThanOrEqual(1)
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/environment.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```js
// Day/night palette + pure mapping helpers. No Three.js / Vue deps (unit-testable).
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a || 1e-6), 0, 1); return t * t * (3 - 2 * t) }

// Keyframes by dayPhase (0 night → 1 noon). Colors 0xRRGGBB.
export const PALETTE = [
	{ p: 0.00, skyZenith: 0x0a0f1e, skyHorizon: 0x1a2238, ambient: 0x26304d, sunColor: 0x3a4a6b, sunIntensity: 0.05, fog: 0x0a0f1e, exposure: 0.22, starOpacity: 1.0 },
	{ p: 0.50, skyZenith: 0x2b3a66, skyHorizon: 0xe8975a, ambient: 0x6b5a52, sunColor: 0xffb066, sunIntensity: 0.60, fog: 0xcaa07a, exposure: 0.55, starOpacity: 0.3 },
	{ p: 1.00, skyZenith: 0x3a7bd5, skyHorizon: 0x9ec9ee, ambient: 0xfff4e6, sunColor: 0xfff4e6, sunIntensity: 1.00, fog: 0x87ceeb, exposure: 1.00, starOpacity: 0.0 },
]

export function elevationFromSunDir(dir) { return clamp(dir?.[2] ?? 0, -1, 1) }

// elev -1..1 → phase 0..1. Horizon (elev 0) lands at 0.5; below horizon compresses toward night.
export function dayPhaseFromElevation(elev) {
	const e = clamp(elev, -1, 1)
	return e >= 0 ? 0.5 + 0.5 * smoothstep(0, 0.35, e) : 0.5 * smoothstep(-0.18, 0, e)
}

function lerpColor(a, b, t) {
	const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255
	const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255
	const r = Math.round(ar + (br - ar) * t), g = Math.round(ag + (bg - ag) * t), bl = Math.round(ab + (bb - ab) * t)
	return (r << 16) | (g << 8) | bl
}
const lerp = (a, b, t) => a + (b - a) * t

export function samplePalette(phase) {
	const p = clamp(phase, 0, 1)
	let lo = PALETTE[0], hi = PALETTE[PALETTE.length - 1]
	for (let i = 0; i < PALETTE.length - 1; i++) {
		if (p >= PALETTE[i].p && p <= PALETTE[i + 1].p) { lo = PALETTE[i]; hi = PALETTE[i + 1]; break }
	}
	const t = (p - lo.p) / ((hi.p - lo.p) || 1e-6)
	return {
		skyZenith: lerpColor(lo.skyZenith, hi.skyZenith, t),
		skyHorizon: lerpColor(lo.skyHorizon, hi.skyHorizon, t),
		ambient: lerpColor(lo.ambient, hi.ambient, t),
		sunColor: lerpColor(lo.sunColor, hi.sunColor, t),
		sunIntensity: lerp(lo.sunIntensity, hi.sunIntensity, t),
		fog: lerpColor(lo.fog, hi.fog, t),
		exposure: lerp(lo.exposure, hi.exposure, t),
		starOpacity: lerp(lo.starOpacity, hi.starOpacity, t),
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/environment.test.js`
Expected: PASS.

- [ ] **Step 5: Stage**

```bash
git add src/lib/environment.js src/lib/__tests__/environment.test.js
```
Commit message: `feat(env): day/night palette + sun-elevation math`

---

### Task 4: Client — `useEnvironment` composable (state + extrapolation + socket)

**Files:**
- Create: `src/composables/useEnvironment.js`
- Test: `src/composables/__tests__/useEnvironment.test.js` (Create)

**Interfaces:**
- Consumes: `src/lib/environment.js` (Task 3); the realtime socket singleton `useRealtimeSocket.js`; `S.ENVIRONMENT_TIME` (Task 2); a prefs source (Task 7 — read defensively, default cycle ON, no override).
- Produces a singleton with:
  - `ingestServerTime(msg)` — store sample `{ sunDirection, sunAngVelocity, secPerDay, usecSinceStart, receivedAtMs }`.
  - `update(dtSeconds)` — advance the sun and recompute the current palette + sun direction; returns nothing (mutates internal reactive `env`).
  - `env` (reactive): `{ palette: EnvPalette, sunDirThree: {x,y,z}, phase: number }`.
  - `setOverride(timeOfDay01 | null)`, `setCycleEnabled(bool)`.

- [ ] **Step 1: Write the failing test (pure logic via a seam)**

```js
import { describe, it, expect } from 'vitest'
import { advanceSunDir } from '../useEnvironment.js'

describe('advanceSunDir', () => {
	it('rotates the sun about world-up by angVel*dt and renormalizes', () => {
		// sun on +X horizon, small +z angular velocity → stays unit length, moves off pure +X
		const out = advanceSunDir([1, 0, 0], [0, 0, 0.5], 1.0)
		const len = Math.hypot(out[0], out[1], out[2])
		expect(len).toBeCloseTo(1, 3)
		expect(out).not.toEqual([1, 0, 0])
	})
	it('zero angular velocity is identity', () => {
		expect(advanceSunDir([0, 0, 1], [0, 0, 0], 5)).toEqual([0, 0, 1])
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/composables/__tests__/useEnvironment.test.js`
Expected: FAIL — `advanceSunDir` not exported.

- [ ] **Step 3: Implement the composable**

```js
import { reactive } from 'vue'
import { elevationFromSunDir, dayPhaseFromElevation, samplePalette } from '@/lib/environment.js'
import { useRealtimeSocket } from '@/composables/useRealtimeSocket.js'
import { S } from '@shared/protocol.js'

// Rotate a unit sun direction by an angular-velocity vector over dt (rad), renormalize.
// Small-angle integration is fine — server corrections re-seed frequently enough.
export function advanceSunDir(dir, angVel, dt) {
	const w = [angVel[0] * dt, angVel[1] * dt, angVel[2] * dt]
	// cross(w, dir)
	const cx = w[1] * dir[2] - w[2] * dir[1]
	const cy = w[2] * dir[0] - w[0] * dir[2]
	const cz = w[0] * dir[1] - w[1] * dir[0]
	let nx = dir[0] + cx, ny = dir[1] + cy, nz = dir[2] + cz
	const len = Math.hypot(nx, ny, nz) || 1
	return [nx / len, ny / len, nz / len]
}

const DEFAULT_SEC_PER_DAY = 14400
let _instance = null

export function useEnvironment() {
	if (_instance) return _instance

	const env = reactive({ palette: samplePalette(1), sunDirThree: { x: 0.4, y: 0.8, z: 0.4 }, phase: 1 })
	let sample = null         // last server sample
	let curDir = [0.4, 0.8, 0.4] // SL-frame working sun dir (seed = pleasant midday)
	let cycleEnabled = true
	let override = null        // 0..1 or null

	function ingestServerTime(msg) {
		sample = { sunDirection: msg.sunDirection, sunAngVelocity: msg.sunAngVelocity,
			secPerDay: msg.secPerDay || DEFAULT_SEC_PER_DAY, receivedAtMs: performance.now() }
		curDir = msg.sunDirection.slice()
	}

	function dirFromOverride(tod) {
		// tod 0..1 over a day; elevation = sin(2π(tod-0.25)) so 0.25=sunrise, 0.5=noon, 0.75=sunset
		const a = 2 * Math.PI * (tod - 0.25)
		const z = Math.sin(a), x = Math.cos(a)
		return [x, 0, z]
	}

	function update(dt) {
		if (override != null) {
			curDir = dirFromOverride(override)
		} else if (cycleEnabled && sample) {
			curDir = advanceSunDir(curDir, sample.sunAngVelocity, dt)
		} // else: hold curDir (no data) — local static fallback
		const elev = elevationFromSunDir(curDir)
		const phase = dayPhaseFromElevation(elev)
		env.phase = phase
		env.palette = samplePalette(phase)
		// SL Z-up → Three Y-up (mirror of slToThree direction): (x, z, -y)
		env.sunDirThree = { x: curDir[0], y: curDir[2], z: -curDir[1] }
	}

	function setOverride(v) { override = v }
	function setCycleEnabled(v) { cycleEnabled = !!v }

	// Subscribe to server time relays.
	try {
		const { on } = useRealtimeSocket()
		on?.(S.ENVIRONMENT_TIME, ingestServerTime)
	} catch { /* socket not ready in tests */ }

	_instance = { env, update, ingestServerTime, setOverride, setCycleEnabled, dirFromOverride }
	return _instance
}
```

(Match the actual subscription API of `useRealtimeSocket.js` — if it exposes a different register method than `on(type, cb)`, use that; the test only covers `advanceSunDir`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/composables/__tests__/useEnvironment.test.js`
Expected: PASS.

- [ ] **Step 5: Stage**

```bash
git add src/composables/useEnvironment.js src/composables/__tests__/useEnvironment.test.js
```
Commit message: `feat(env): useEnvironment state + sun extrapolation`

---

### Task 5: Engine — tone mapping switch + per-frame env wiring

**Files:**
- Modify: `src/composables/useWorldEngine.js` — renderer init (~L1565), light refs (~L1662–1671), `animate()` (~L4488–4506).

**Interfaces:**
- Consumes: `useEnvironment()` (Task 4).
- Produces: the existing `sun`/`fill`/`ambient` lights, `scene.fog`, and `renderer.toneMappingExposure` are driven by `env.palette` each frame.

- [ ] **Step 1: Switch tone mapping (one-time, renderer init ~L1565)**

Change `renderer.toneMapping = THREE.NoToneMapping` → `THREE.LinearToneMapping`; set `renderer.toneMappingExposure = 1.0`. WHY: Linear@1.0 ≈ identity, but exposure now becomes a live global-brightness lever.

- [ ] **Step 2: Hold light refs accessible in `animate()`**

Ensure `sun`, `ambient` (the warm DirectionalLight + AmbientLight created ~L1662/L1671) are reachable from `animate()` (module-scope refs in this composable). No behavior change yet.

- [ ] **Step 3: Drive lights/fog/exposure from env each frame**

In `animate()` after `dt` is computed (~L4504), before `renderer.render`:

```js
const environment = useEnvironment()  // import at top: import { useEnvironment } from '@/composables/useEnvironment.js'
environment.update(dt)
const pal = environment.env.palette
const sd = environment.env.sunDirThree
sun.position.set(sd.x * 200, sd.y * 200, sd.z * 200)
sun.color.setHex(pal.sunColor)
sun.intensity = pal.sunIntensity
ambient.color.setHex(pal.ambient)
if (scene.fog) scene.fog.color.setHex(pal.fog)
renderer.toneMappingExposure = pal.exposure
```

- [ ] **Step 4: Verify (live, no unit test — visual)**

Run the app (Vite 5174). On connect, the world should brighten/darken smoothly; lit-shading prims should shade off the moving sun; the day scene at exposure 1.0 should look unchanged from before the tone-mapping switch.
Expected: no color regression at midday; visible exposure change as sun elevation changes (force-test via Task 7 override slider once it exists, or temporarily call `environment.setOverride(0)` to see night).

- [ ] **Step 5: Stage**

```bash
git add src/composables/useWorldEngine.js
```
Commit message: `feat(env): drive lights+fog+exposure from day/night state`

---

### Task 6: Client — `SkyDome` gradient sky

**Files:**
- Create: `src/lib/skyDome.js` (factory: build mesh + an `update(palette, sunDirThree, cameraPos)` fn)
- Modify: `src/composables/useWorldEngine.js` — instantiate the dome, set `scene.background = null`, call `skyDome.update(...)` in `animate()`.

**Interfaces:**
- Consumes: `env.palette` (`skyZenith`, `skyHorizon`, `starOpacity`), `env.sunDirThree`, camera position.
- Produces: `createSkyDome(THREE): { mesh, update(palette, sunDirThree, cameraPos) }`.

- [ ] **Step 1: Implement the dome factory**

```js
// Large inverted sphere backdrop with a zenith→horizon gradient, sun glow, and fading stars.
export function createSkyDome(THREE) {
	const geo = new THREE.SphereGeometry(4000, 32, 16)
	const mat = new THREE.ShaderMaterial({
		side: THREE.BackSide, depthWrite: false, fog: false,
		uniforms: {
			uZenith: { value: new THREE.Color(0x3a7bd5) },
			uHorizon: { value: new THREE.Color(0x9ec9ee) },
			uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.4) },
			uStar: { value: 0.0 },
		},
		vertexShader: `
			varying vec3 vDir;
			void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
		fragmentShader: `
			uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uSunDir; uniform float uStar;
			varying vec3 vDir;
			float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719)))*43758.5453); }
			void main() {
				float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
				vec3 col = mix(uHorizon, uZenith, pow(h, 0.6));
				float sun = pow(max(dot(normalize(vDir), normalize(uSunDir)), 0.0), 128.0);
				col += vec3(1.0, 0.9, 0.7) * sun;                       // sun disc/glow
				float glow = pow(max(dot(normalize(vDir), normalize(uSunDir)), 0.0), 4.0);
				col += vec3(1.0, 0.6, 0.3) * glow * 0.25;               // horizon-ward halo
				float st = step(0.998, hash(floor(vDir * 600.0))) * uStar * smoothstep(0.0, 0.3, vDir.y);
				col += vec3(st);
				gl_FragColor = vec4(col, 1.0);
			}`,
	})
	const mesh = new THREE.Mesh(geo, mat)
	mesh.frustumCulled = false
	return {
		mesh,
		update(palette, sunDirThree, cameraPos) {
			mat.uniforms.uZenith.value.setHex(palette.skyZenith)
			mat.uniforms.uHorizon.value.setHex(palette.skyHorizon)
			mat.uniforms.uSunDir.value.set(sunDirThree.x, sunDirThree.y, sunDirThree.z)
			mat.uniforms.uStar.value = palette.starOpacity
			mesh.position.copy(cameraPos)  // sky never approached
		},
	}
}
```

- [ ] **Step 2: Wire into the engine**

In `useWorldEngine.js` scene setup: `import { createSkyDome } from '@/lib/skyDome.js'`; after scene/renderer exist, `const skyDome = createSkyDome(THREE); scene.add(skyDome.mesh); scene.background = null` (remove the solid `0x87ceeb` background at ~L1536; keep the fog). In `animate()` after `environment.update(dt)`: `skyDome.update(pal, sd, camera.position)`.

- [ ] **Step 3: Guard compile failure**

Wrap dome creation in try/catch; on failure, restore `scene.background = new THREE.Color(pal.skyZenith)` and skip the dome (render-quarantine pattern). WHY: a shader compile error must never blank the scene.

- [ ] **Step 4: Verify (live, visual)**

Expected: gradient sky behind the world; a bright sun spot tracking the sun light; stars fade in at night (test via override). No horizontal-scroll/perf regression.

- [ ] **Step 5: Stage**

```bash
git add src/lib/skyDome.js src/composables/useWorldEngine.js
```
Commit message: `feat(env): gradient sky dome with sun glow + stars`

---

### Task 7: Preferences — day/night cycle toggle + time-of-day override slider

**Files:**
- Modify: the QuickPrefs/Preferences graphics panel that hosts the existing "Lit Shading" toggle (locate via grep `Lit Shading`), and the prefs store it writes to.
- Modify: `src/composables/useEnvironment.js` — read the persisted prefs on init.

**Interfaces:**
- Consumes: `useEnvironment().setCycleEnabled`, `.setOverride`.
- Produces: persisted prefs `env.cycleEnabled: boolean` (default true) and `env.timeOfDayOverride: number|null` (0..1, default null).

- [ ] **Step 1: Add persisted pref fields**

In the prefs store next to the Lit-Shading flag, add `cycleEnabled` (default `true`) and `timeOfDayOverride` (default `null`), persisted the same way the other graphics prefs persist.

- [ ] **Step 2: Add UI controls**

In the graphics prefs panel, beneath Lit Shading: a checkbox "Day/Night cycle (follow region time)" bound to `cycleEnabled`; when unchecked, reveal a range slider 0–1 (label "Time of day") bound to `timeOfDayOverride`. Use existing `qs-` control classes + Tailwind tokens. On change: call `useEnvironment().setCycleEnabled(v)` / `.setOverride(checked ? null : sliderVal)`.

- [ ] **Step 3: Honor prefs on init**

In `useEnvironment()` init, read the store: `setCycleEnabled(store.cycleEnabled)`; if `!cycleEnabled` set `setOverride(store.timeOfDayOverride ?? 0.5)`.

- [ ] **Step 4: Verify (live, visual)**

Expected: unchecking the cycle freezes the sky and reveals the slider; dragging the slider sweeps dawn→noon→dusk→night live (this is also the manual force-test for Tasks 5–6). Choice persists across reload.

- [ ] **Step 5: Stage**

```bash
git add -A
```
Commit message: `feat(env): day/night cycle pref + time-of-day override`

---

### Task 8: Terrain — wire region detail textures (verify/fix)

**Files:**
- Inspect/Modify: the path from `decodeRegionHandshake` (`server/lib/lludp-codec.ts:1718`) → client → `src/lib/terrainMaterial.js` / terrain build in `useWorldEngine.js` (~L1501–1600).

**Interfaces:**
- Consumes: `RegionHandshake.terrainDetail[]` (4 UUIDs), `terrainStartHeight[]`, `terrainHeightRange[]`.
- Produces: terrain shader sampling the region's actual 4 textures (not bundled defaults) when present.

- [ ] **Step 1: Trace the current wire**

Determine whether the decoded `terrainDetail` UUIDs already reach `terrainMaterial.js` or whether it always uses `terrainTextures.js` defaults. Grep `terrainDetail`, `TerrainTexture`, `terrainStartHeight` across `src/` and `server/`.

- [ ] **Step 2: Fix if defaults-only**

If the region UUIDs are not flowing: fetch each via the existing texture cache (the same path other textures use — `ASSET_FETCH` `texture`), assign to `uTex0..3`, and pass `terrainStartHeight`/`terrainHeightRange` into the existing `layerWeights()` uniforms. Fall back to the bundled WebP default for any missing/dead asset.

- [ ] **Step 3: Verify (live, visual)**

Expected: on a region with custom ground textures, terrain shows them; on a default region, unchanged. No regression to the elevation blend.

- [ ] **Step 4: Stage**

```bash
git add -A
```
Commit message: `feat(env): use region terrain detail textures`

---

### Task 9: Client — procedural cloud layer

**Files:**
- Create: `src/lib/cloudLayer.js`
- Modify: `src/composables/useWorldEngine.js` — instantiate + `update()` in `animate()`.

**Interfaces:**
- Consumes: `env.palette` (tint via `skyHorizon`/`starOpacity` for night fade), `dt`, camera position.
- Produces: `createCloudLayer(THREE): { mesh, update(palette, dt, cameraPos) }`.

- [ ] **Step 1: Implement the cloud factory**

```js
// High translucent plane with scrolling procedural noise; tint/opacity follow time of day.
export function createCloudLayer(THREE) {
	const geo = new THREE.PlaneGeometry(6000, 6000, 1, 1)
	const mat = new THREE.ShaderMaterial({
		transparent: true, depthWrite: false, fog: false,
		uniforms: { uTime: { value: 0 }, uTint: { value: new THREE.Color(0xffffff) }, uOpacity: { value: 0.5 } },
		vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
		fragmentShader: `
			uniform float uTime; uniform vec3 uTint; uniform float uOpacity; varying vec2 vUv;
			float noise(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
			float fbm(vec2 p){ float v=0.0,a=0.5; for(int i=0;i<4;i++){ v+=a*noise(p); p*=2.0; a*=0.5; } return v; }
			void main(){
				vec2 uv = vUv * 6.0 + vec2(uTime * 0.01, uTime * 0.004);
				float c = smoothstep(0.55, 0.9, fbm(uv));
				gl_FragColor = vec4(uTint, c * uOpacity);
			}`,
	})
	const mesh = new THREE.Mesh(geo, mat)
	mesh.rotation.x = -Math.PI / 2
	mesh.frustumCulled = false
	return {
		mesh,
		update(palette, dt, cameraPos) {
			mat.uniforms.uTime.value += dt
			mat.uniforms.uTint.value.setHex(palette.skyHorizon)
			mat.uniforms.uOpacity.value = 0.45 * (1.0 - palette.starOpacity) + 0.08  // thinner at night
			mesh.position.set(cameraPos.x, 900, cameraPos.z)
		},
	}
}
```

- [ ] **Step 2: Wire into the engine**

`import { createCloudLayer }`; `const clouds = createCloudLayer(THREE); scene.add(clouds.mesh)`; in `animate()`: `clouds.update(pal, dt, camera.position)`. Wrap in try/catch (quarantine).

- [ ] **Step 3: Verify (live, visual)**

Expected: soft clouds drift overhead; thin out and tint at night/dusk; no perf regression (single plane, 4-octave fbm).

- [ ] **Step 4: Stage**

```bash
git add src/lib/cloudLayer.js src/composables/useWorldEngine.js
```
Commit message: `feat(env): procedural drifting cloud layer`

---

### Task 10: Trees / plants billboards (independent — reference read first)

**Files:**
- Create: `src/lib/treeBillboards.js` (+ a small species→texture table) and bundled WebP billboards under `src/assets/` (or existing asset dir).
- Modify: prim spawn path in `useWorldEngine.js` — branch PCode TREE/GRASS to a billboard instead of prim geometry.

**Interfaces:**
- Consumes: object spawn data (PCode + tree species byte + position/scale).
- Produces: `createTreeBillboard(THREE, species, scale): THREE.Sprite | THREE.Mesh`.

- [ ] **Step 1: Reference read (REQUIRED — do not hand-derive)**

Read the tree-species enum + default-texture mapping from `../opensim` and/or libopenmetaverse (search `Tree` / `PCODE_TREE` / `treeSpecies`). Record: PCode values for TREE (15) and GRASS (20), the species enum, and which species share textures. Capture the mapping in a comment block in `treeBillboards.js`.

- [ ] **Step 2: Bundle a handful of billboard textures**

Add 4–8 generic tree/plant WebP billboards under the assets dir. Map each species → one bundled texture (DRY: many species can reuse the same generic billboard for v1).

- [ ] **Step 3: Implement the billboard factory**

A camera-facing `THREE.Sprite` (or a quad with `material.depthWrite=true`, alpha-tested) sized by the prim scale. Anchor at the prim's ground position.

- [ ] **Step 4: Branch the spawn path**

In the prim build path, detect PCode TREE/GRASS and route to `createTreeBillboard` instead of building prim geometry. Guard: unknown species → default billboard.

- [ ] **Step 5: Verify (live, visual)**

Expected: system trees/plants on a region render as upright billboards instead of being missing/boxes. No effect on normal prims.

- [ ] **Step 6: Stage**

```bash
git add -A
```
Commit message: `feat(env): system tree/plant billboards`

---

## Self-Review

**Spec coverage:**
- SimulatorViewerTime decode + relay → Tasks 1–2 ✅
- useEnvironment single-source + extrapolation + palette → Tasks 3–4 ✅
- SkyDome → Task 6 ✅
- Engine exposure/light/fog wiring + tone-mapping switch → Task 5 ✅
- Terrain detail textures → Task 8 ✅
- Procedural clouds → Task 9 ✅
- Trees → Task 10 ✅
- Preferences (cycle toggle + override) → Task 7 ✅
- Error handling: exposure clamp (Task 3 palette + test), shader quarantine (Tasks 6, 9), no-time-message fallback (Task 4 holds curDir / override) ✅

**Type consistency:** `EnvPalette` fields (`skyZenith, skyHorizon, ambient, sunColor, sunIntensity, fog, exposure, starOpacity`) are defined in Task 3 and consumed identically in Tasks 5/6/9. `env.sunDirThree` `{x,y,z}` defined in Task 4, consumed in Tasks 5/6. `SimulatorViewerTimeData` fields match between Task 1 and the relay in Task 2 and `ingestServerTime` in Task 4.

**Placeholder scan:** No TBD/TODO; every code step has concrete code. Tasks 8 and 10 begin with an inspect/reference-read step because their exact edit depends on live code/reference (the steps say precisely what to find and what to do with it).

**Note on ordering:** Tasks 1–2 are the only server edits — execute together, one Bun restart. Tasks 3–10 are client-only (Vite HMR keeps the circuit). Tasks 3→4→5→6 are sequential (each consumes the prior). Tasks 7, 8, 9, 10 are independent of each other once 3–6 land and can be batched/parallelized.
