# Terrain Texturing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the elevation-only vertex-color terrain with SL-parity 4-texture, height-blended, noise-dithered terrain — bundled local defaults for instant paint plus grid-supplied custom textures.

**Architecture:** Two new pure libs (`terrainTextures.js` for slot resolution + blend math, exercised by unit tests) and one material builder (`terrainMaterial.js`, a custom unlit `ShaderMaterial`). `useWorldEngine.js` watches `sessionStore.terrainTextures` (already populated from RegionHandshake), resolves each of 4 slots (bundled WebP for known defaults, `useTextureFetch.getTexture()` for customs), then swaps the terrain mesh from its vertex-color `MeshBasicMaterial` to the shader once all slots are bound.

**Tech Stack:** Three.js (`ShaderMaterial`, `TextureLoader`), Vue/Pinia (`sessionStore`, `watch`), Vite WebP asset imports, bun:test for pure-lib unit tests.

---

## File Structure

- **Create** `src/lib/terrainTextures.js` — `DEFAULT_TERRAIN_UUIDS` map (UUID→bundled WebP url), `resolveTerrainSlot()`, `bilerpCorners()`, `layerWeights()`. Pure except the WebP imports.
- **Create** `src/lib/terrainMaterial.js` — `buildTerrainMaterial()` returning a configured `THREE.ShaderMaterial`; `setTerrainSlot()` helper to bind one sampler uniform.
- **Create** `src/__tests__/lib/terrainTextures.test.js` — unit tests for the pure helpers (matches the `src/__tests__/lib/*.test.js` + `@/`-alias convention used by `planarUV.test.js`, `cullPolicy.test.js`, etc.).
- **Modify** `src/composables/useWorldEngine.js` — add `loadTerrainTextures()`, a `watch` on `sessionStore.terrainTextures`, and the material swap; dispose on teardown/region change.
- **Assets (already present)** `src/assets/img/terrain-{dirt,grass,rock,mountain}.webp`.

Corner arrays (`startHeight`/`heightRange`) are ordered `[00, 01, 10, 11]` = `[x][y]` (x: 0=west/low-X, 1=east/high-X; y: 0=south/low-Y, 1=north/high-Y) per `lludp-codec.ts:1783-1788`.

---

### Task 1: Slot resolution — `DEFAULT_TERRAIN_UUIDS` + `resolveTerrainSlot`

**Files:**
- Create: `src/lib/terrainTextures.js`
- Test: `src/__tests__/lib/terrainTextures.test.js`

- [ ] **Step 1: Verify the default UUIDs against OpenSim source**

Before writing code, confirm the 4 well-known default terrain texture UUIDs. Check the local OpenSim checkout for `RegionSettings.cs` constants `DEFAULT_TERRAIN_TEXTURE_1..4`:

Run: `Grep` for `DEFAULT_TERRAIN_TEXTURE_` in the `opensim/` reference checkout.
Expected: four UUID string constants. Use those exact values below. If the checkout is unavailable, the historically-stable values are:
- 1 (dirt/low):     `b8d3965a-ad78-bf43-699b-bff8eca6c975`
- 2 (grass):        `abb783e6-3e93-26c0-248a-247666855da3`
- 3 (rock/mid):     `179cdabd-398a-9b6b-1391-4dc333ba321f`
- 4 (mountain/high):`beb169c7-11ea-fff2-efe5-0f24dc881df2`

Record the confirmed values; if they differ from the above, substitute them in Step 3 and the test.

- [ ] **Step 2: Write the failing test**

```javascript
// src/__tests__/lib/terrainTextures.test.js
import { test, expect } from 'bun:test'
import { resolveTerrainSlot, DEFAULT_TERRAIN_UUIDS } from '@/lib/terrainTextures.js'

test('resolveTerrainSlot maps a known default UUID to a bundled url', () => {
	const dirt = Object.keys(DEFAULT_TERRAIN_UUIDS)[0]
	const r = resolveTerrainSlot(dirt)
	expect(r.kind).toBe('default')
	expect(typeof r.url).toBe('string')
	expect(r.url.length).toBeGreaterThan(0)
})

test('resolveTerrainSlot treats an unknown UUID as custom', () => {
	const r = resolveTerrainSlot('00000000-1111-2222-3333-444444444444')
	expect(r.kind).toBe('custom')
	expect(r.uuid).toBe('00000000-1111-2222-3333-444444444444')
})

test('resolveTerrainSlot falls back to the grass default for an empty slot', () => {
	const r = resolveTerrainSlot('')
	expect(r.kind).toBe('default')
	expect(typeof r.url).toBe('string')
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test src/__tests__/lib/terrainTextures.test.js`
Expected: FAIL — `Cannot find module '@/lib/terrainTextures.js'`.

- [ ] **Step 4: Write minimal implementation**

```javascript
// src/lib/terrainTextures.js
// WHY: SL terrain = 4 detail textures blended by elevation. Regions that don't
// override a slot send the well-known DEFAULT terrain UUID; bundling those defaults
// locally lets us paint instantly (browser-native WebP, no grid fetch / no J2C decode)
// and gives a correct-looking fallback while a custom slot's texture decodes.
import dirtUrl     from '@/assets/img/terrain-dirt.webp'
import grassUrl    from '@/assets/img/terrain-grass.webp'
import rockUrl     from '@/assets/img/terrain-rock.webp'
import mountainUrl from '@/assets/img/terrain-mountain.webp'

// Confirmed vs OpenSim RegionSettings.cs DEFAULT_TERRAIN_TEXTURE_1..4 (see plan Task 1 Step 1).
export const DEFAULT_TERRAIN_UUIDS = {
	'b8d3965a-ad78-bf43-699b-bff8eca6c975': dirtUrl,
	'abb783e6-3e93-26c0-248a-247666855da3': grassUrl,
	'179cdabd-398a-9b6b-1391-4dc333ba321f': rockUrl,
	'beb169c7-11ea-fff2-efe5-0f24dc881df2': mountainUrl,
}

// Fallback bound to a slot whose texture is empty/not-yet-resolved so the shader is never under-bound.
export const FALLBACK_TERRAIN_URL = grassUrl

/**
 * Classify a terrain detail slot UUID.
 * @returns {{kind:'default', url:string} | {kind:'custom', uuid:string}}
 */
export function resolveTerrainSlot(uuid) {
	if (!uuid) return { kind: 'default', url: FALLBACK_TERRAIN_URL }
	const url = DEFAULT_TERRAIN_UUIDS[uuid]
	if (url) return { kind: 'default', url }
	return { kind: 'custom', uuid }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test src/__tests__/lib/terrainTextures.test.js`
Expected: PASS (3 tests). The `@/` alias already resolves under bun:test (see `planarUV.test.js`). If bun chokes on the `.webp` import, see Step 6.

- [ ] **Step 6: Handle the WebP import under bun:test if Step 5 fails**

`planarUV.js` and peers don't import assets, so the `.webp` import is the only novel risk. If bun can't load `.webp`, add a `bunfig.toml` loader mapping `.webp` → `file` (or `text`), so the production import path stays identical. Re-run Step 5 to PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/terrainTextures.js src/__tests__/lib/terrainTextures.test.js
git commit -m "feat(terrain): terrain detail-slot resolution + bundled defaults"
```

---

### Task 2: Blend math — `bilerpCorners` + `layerWeights`

**Files:**
- Modify: `src/lib/terrainTextures.js`
- Test: `src/__tests__/lib/terrainTextures.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// append to src/__tests__/lib/terrainTextures.test.js
import { bilerpCorners, layerWeights } from '@/lib/terrainTextures.js'

test('bilerpCorners returns the right corner at the corners', () => {
	const c = [10, 20, 30, 40] // [00,01,10,11] = [x][y]
	expect(bilerpCorners(c, 0, 0)).toBeCloseTo(10) // x=0,y=0
	expect(bilerpCorners(c, 0, 1)).toBeCloseTo(20) // x=0,y=1
	expect(bilerpCorners(c, 1, 0)).toBeCloseTo(30) // x=1,y=0
	expect(bilerpCorners(c, 1, 1)).toBeCloseTo(40) // x=1,y=1
})

test('bilerpCorners interpolates the center', () => {
	expect(bilerpCorners([0, 0, 0, 100], 0.5, 0.5)).toBeCloseTo(25)
})

test('layerWeights sums to ~1 and picks the right dominant layer', () => {
	// start=0, range=100 → e=(h-0)/100; with noise 0
	const low  = layerWeights(0,   0, 100, 0)   // e=0   → layer 0
	const high = layerWeights(100, 0, 100, 0)   // e=1   → layer 3
	const sum = a => a.reduce((s, v) => s + v, 0)
	expect(sum(low)).toBeCloseTo(1)
	expect(sum(high)).toBeCloseTo(1)
	expect(low[0]).toBeGreaterThan(low[3])
	expect(high[3]).toBeGreaterThan(high[0])
})

test('layerWeights clamps below start and above start+range', () => {
	const below = layerWeights(-50, 0, 100, 0)
	const above = layerWeights(999, 0, 100, 0)
	expect(below[0]).toBeCloseTo(1)
	expect(above[3]).toBeCloseTo(1)
})

test('layerWeights blends adjacent layers mid-band', () => {
	const w = layerWeights(50, 0, 100, 0) // e=0.5 → p=1.5 → layers 1&2
	expect(w[1]).toBeGreaterThan(0)
	expect(w[2]).toBeGreaterThan(0)
	expect(w[0]).toBeCloseTo(0)
	expect(w[3]).toBeCloseTo(0)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/__tests__/lib/terrainTextures.test.js`
Expected: FAIL — `bilerpCorners is not a function`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// append to src/lib/terrainTextures.js

/**
 * Bilinear interpolation of a 4-corner value array ordered [00,01,10,11] = [x][y].
 * @param {number[]} c corners
 * @param {number} u 0..1 along X (west→east)
 * @param {number} v 0..1 along Y (south→north)
 */
export function bilerpCorners(c, u, v) {
	const x0 = c[0] * (1 - v) + c[1] * v   // x=0 edge (00→01)
	const x1 = c[2] * (1 - v) + c[3] * v   // x=1 edge (10→11)
	return x0 * (1 - u) + x1 * u
}

/**
 * SL-style 4-layer terrain blend weights from elevation.
 * e = (elev - start) / range, dithered by `noise`, clamped 0..1, spread across the
 * 4 detail layers as a triangular (adjacent-pair) blend. The GLSL fragment mirrors this.
 * @returns {number[]} length-4 weights summing to ~1
 */
export function layerWeights(elev, start, range, noise) {
	const r = range === 0 ? 1e-6 : range
	let e = (elev - start) / r + noise
	if (e < 0) e = 0
	if (e > 1) e = 1
	const p = e * 3                 // position across layers 0..3
	const lo = Math.min(Math.floor(p), 3)
	const hi = Math.min(lo + 1, 3)
	const f = p - lo
	const w = [0, 0, 0, 0]
	w[lo] += 1 - f
	w[hi] += f
	return w
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/__tests__/lib/terrainTextures.test.js`
Expected: PASS (all 8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/terrainTextures.js src/__tests__/lib/terrainTextures.test.js
git commit -m "feat(terrain): bilinear corner + elevation blend-weight math"
```

---

### Task 3: Terrain `ShaderMaterial` builder

**Files:**
- Create: `src/lib/terrainMaterial.js`

GLSL is not unit-tested (no GL context in bun); correctness is covered by the JS twins in Task 2 (same math) plus the live-verify in Task 5. Build verification confirms it compiles into the bundle.

- [ ] **Step 1: Write the material builder**

```javascript
// src/lib/terrainMaterial.js
import * as THREE from 'three'

// WHY unlit: matches the existing MeshBasicMaterial-for-terrain decision — a lit
// terrain material reintroduces the ACES/tone-map dark-face artifacts documented in
// the threejs-rendering-decisions memo. The blend mirrors src/lib/terrainTextures.js
// layerWeights() so the JS twins in that file's tests cover the math.

const VERT = /* glsl */`
	varying vec3 vWorld;
	void main() {
		vec4 wp = modelMatrix * vec4(position, 1.0);
		vWorld = wp.xyz;
		gl_Position = projectionMatrix * viewMatrix * wp;
	}
`

const FRAG = /* glsl */`
	precision highp float;
	uniform sampler2D uTex0;
	uniform sampler2D uTex1;
	uniform sampler2D uTex2;
	uniform sampler2D uTex3;
	uniform vec4 uStartHeight;   // [00,01,10,11] = [x][y]
	uniform vec4 uHeightRange;
	uniform vec2 uRegionSize;    // metres (regionSizeX, regionSizeY)
	uniform float uTexScale;     // texture repeats per metre
	uniform float uNoiseScale;
	uniform float uNoiseAmp;
	varying vec3 vWorld;

	float bilerp(vec4 c, float u, float v) {
		float x0 = mix(c.x, c.y, v); // 00→01
		float x1 = mix(c.z, c.w, v); // 10→11
		return mix(x0, x1, u);
	}
	// cheap value-noise FBM for seam dithering
	float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
	float vnoise(vec2 p){
		vec2 i = floor(p), f = fract(p);
		vec2 u = f*f*(3.0-2.0*f);
		return mix(mix(hash(i), hash(i+vec2(1,0)), u.x),
		           mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
	}
	float fbm(vec2 p){ return 0.5*vnoise(p) + 0.25*vnoise(p*2.0) + 0.125*vnoise(p*4.0); }

	void main() {
		// World XZ → region UV. Z is negated in slToThree (Three Z = -slY), and the
		// terrain mesh spans Three Z in [-regionSizeY, 0]; map to v in [0,1] (south→north).
		float u = clamp(vWorld.x / uRegionSize.x, 0.0, 1.0);
		float v = clamp((vWorld.z + uRegionSize.y) / uRegionSize.y, 0.0, 1.0);

		float start = bilerp(uStartHeight, u, v);
		float range = bilerp(uHeightRange, u, v);
		range = (abs(range) < 1e-4) ? 1e-4 : range;

		float noise = (fbm(vWorld.xz * uNoiseScale) - 0.5) * uNoiseAmp;
		float e = clamp((vWorld.y - start) / range + noise, 0.0, 1.0);
		float p = e * 3.0;
		float lo = min(floor(p), 3.0);
		float f = p - lo;

		// triangular adjacent-pair weights (mirror of layerWeights())
		float w0 = (lo == 0.0 ? 1.0 - f : 0.0) + (lo == 1.0 ? 0.0 : 0.0);
		float w1 = (lo == 0.0 ? f : 0.0) + (lo == 1.0 ? 1.0 - f : 0.0);
		float w2 = (lo == 1.0 ? f : 0.0) + (lo == 2.0 ? 1.0 - f : 0.0);
		float w3 = (lo == 2.0 ? f : 0.0) + (lo == 3.0 ? 1.0 : 0.0);

		vec2 st = vWorld.xz * uTexScale;
		vec3 col = texture2D(uTex0, st).rgb * w0
		         + texture2D(uTex1, st).rgb * w1
		         + texture2D(uTex2, st).rgb * w2
		         + texture2D(uTex3, st).rgb * w3;
		gl_FragColor = vec4(col, 1.0);
	}
`

// 1×1 transparent placeholder so uniforms are never null before textures bind.
function placeholderTex() {
	const t = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1, THREE.RGBAFormat)
	t.needsUpdate = true
	return t
}

/**
 * Build the terrain shader material.
 * @param {{startHeight:number[], heightRange:number[], regionSizeX:number, regionSizeY:number}} opts
 */
export function buildTerrainMaterial(opts) {
	const ph = placeholderTex()
	return new THREE.ShaderMaterial({
		uniforms: {
			uTex0: { value: ph }, uTex1: { value: ph }, uTex2: { value: ph }, uTex3: { value: ph },
			uStartHeight: { value: new THREE.Vector4(...opts.startHeight) },
			uHeightRange: { value: new THREE.Vector4(...opts.heightRange) },
			uRegionSize:  { value: new THREE.Vector2(opts.regionSizeX, opts.regionSizeY) },
			uTexScale:    { value: 1 / 8 },   // SL terrain ~ one tile per 8 m; tune live
			uNoiseScale:  { value: 0.05 },
			uNoiseAmp:    { value: 0.35 },
		},
		vertexShader: VERT,
		fragmentShader: FRAG,
		side: THREE.FrontSide,
	})
}

/** Bind one detail texture into slot 0..3 (sets RepeatWrapping + sRGB). */
export function setTerrainSlot(material, slot, texture) {
	if (!material || !texture) return
	texture.wrapS = texture.wrapT = THREE.RepeatWrapping
	texture.colorSpace = THREE.SRGBColorSpace
	texture.needsUpdate = true
	material.uniforms[`uTex${slot}`].value = texture
	material.uniformsNeedUpdate = true
}
```

- [ ] **Step 2: Verify it compiles in the bundle**

Run: `npm run build:staging`
Expected: build succeeds, no GLSL/import errors. (Material correctness is verified live in Task 5.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/terrainMaterial.js
git commit -m "feat(terrain): SL-parity terrain ShaderMaterial builder"
```

---

### Task 4: Wire into `useWorldEngine` — load, swap, dispose

**Files:**
- Modify: `src/composables/useWorldEngine.js`

Anchor points: the `stopWaterHeightWatch` watch (`useWorldEngine.js:201`), the terrain mesh creation in `initScene()` (`:1162-1166`), the teardown at `onUnmounted`/`stopWaterHeightWatch()` (`:3486`), and `clearTerrain()` usage in the region-change path (`:2314`).

- [ ] **Step 1: Add imports near the top of the file**

```javascript
import { buildTerrainMaterial, setTerrainSlot } from '@/lib/terrainMaterial.js'
import { resolveTerrainSlot } from '@/lib/terrainTextures.js'
// useTextureFetch is already imported in this file — reuse getTexture from it.
```

If `getTexture` is not already in scope, add it to the existing `useTextureFetch()` destructure in this file (the composable returns `{ getTexture, getTextureUrl, clearTextureCache }`).

- [ ] **Step 2: Add module state + `loadTerrainTextures()` near the terrain helpers (after `rebuildTerrainFromStore`, ~`:1105`)**

```javascript
	let terrainShaderMaterial = null   // built lazily once textures arrive
	let _terrainVtxMaterial   = null   // the original MeshBasicMaterial, kept for region resets

	// WHY: RegionHandshake gives 4 detail-texture UUIDs + per-corner start/range. Known
	// default UUIDs paint instantly from bundled WebP (no grid fetch / no J2C decode);
	// custom UUIDs stream through the normal texture pipeline and swap in when decoded.
	async function loadTerrainTextures() {
		if (!terrainMesh) return
		const tt = sessionStore.terrainTextures
		if (!tt || !Array.isArray(tt.detail)) return

		if (!terrainShaderMaterial) {
			terrainShaderMaterial = buildTerrainMaterial({
				startHeight: tt.startHeight,
				heightRange: tt.heightRange,
				regionSizeX: sessionStore.regionSizeX,
				regionSizeY: sessionStore.regionSizeY,
			})
		} else {
			terrainShaderMaterial.uniforms.uStartHeight.value.set(...tt.startHeight)
			terrainShaderMaterial.uniforms.uHeightRange.value.set(...tt.heightRange)
		}

		const loader = new THREE.TextureLoader()
		for (let slot = 0; slot < 4; slot++) {
			const r = resolveTerrainSlot(tt.detail[slot])
			if (r.kind === 'default') {
				loader.load(r.url, (tex) => setTerrainSlot(terrainShaderMaterial, slot, tex))
			} else {
				// fallback default while the custom texture decodes, then swap in
				const fb = resolveTerrainSlot('')
				loader.load(fb.url, (tex) => setTerrainSlot(terrainShaderMaterial, slot, tex))
				getTexture(r.uuid).then((tex) => { if (tex) setTerrainSlot(terrainShaderMaterial, slot, tex) })
			}
		}

		// Swap the mesh onto the shader material (keep the vertex-color one for resets).
		if (terrainMesh.material !== terrainShaderMaterial) {
			_terrainVtxMaterial = terrainMesh.material
			terrainMesh.material = terrainShaderMaterial
		}
	}
```

- [ ] **Step 3: Watch `sessionStore.terrainTextures` next to the existing water-height watch (~`:201`)**

```javascript
	const stopTerrainTexWatch = watch(
		() => sessionStore.terrainTextures,
		() => loadTerrainTextures(),
		{ deep: true, immediate: true },
	)
```

- [ ] **Step 4: Reset terrain material on region change (in the `clearTerrain()` path, ~`:2314`)**

```javascript
		// New region: drop the shader material so the next RegionHandshake rebuilds it,
		// and revert the mesh to the vertex-color material so terrain is never blank.
		if (terrainMesh && _terrainVtxMaterial && terrainMesh.material === terrainShaderMaterial) {
			terrainMesh.material = _terrainVtxMaterial
		}
		terrainShaderMaterial?.dispose()
		terrainShaderMaterial = null
```

- [ ] **Step 5: Dispose on teardown (next to `stopWaterHeightWatch()`, ~`:3486`)**

```javascript
		stopTerrainTexWatch()
		terrainShaderMaterial?.dispose()
		terrainShaderMaterial = null
```

- [ ] **Step 6: Verify the build**

Run: `npm run build:staging`
Expected: build succeeds, no unresolved imports/refs.

- [ ] **Step 7: Run the full unit suite**

Run: `bun test src/__tests__/lib/terrainTextures.test.js`
Expected: PASS (8 tests). (Pre-existing unrelated client-test env fails noted in render-pipeline-state are not introduced by this change.)

- [ ] **Step 8: Commit**

```bash
git add src/composables/useWorldEngine.js
git commit -m "feat(terrain): wire RegionHandshake textures into terrain shader"
```

---

### Task 5: Live verification

**Files:** none (manual verification by the user)

- [ ] **Step 1: Stock-terrain region**

Log into a region that uses default terrain. Expected: terrain paints **textured immediately** on login (bundled WebP, no fetch wait), dirt→grass→rock→mountain by elevation.

- [ ] **Step 2: Custom-terrain region (e.g. NeverWorld)**

Log into a region with custom terrain textures. Expected: defaults show first, then each custom slot swaps in as its J2C decodes; final look matches Firestorm for that region.

- [ ] **Step 3: Seam + tuning check**

Confirm band transitions look **dithered, not hard-striped**. If tiling is too dense/sparse, tune `uTexScale`; if seams too sharp, raise `uNoiseAmp`/`uNoiseScale` in `terrainMaterial.js`.

- [ ] **Step 4: No regression**

Walk/fly across varied elevation. Expected: height, collision (`sampleTerrainHeight`), raycast/Alt-click pivot, and the `iy = ry - slY` orientation are all unchanged — no "walking on water" or sunk-into-hill.

- [ ] **Step 5: Cross-region teleport**

Teleport to another region. Expected: terrain reverts to vertex-color momentarily, then re-textures for the new region (no stale textures, no leak).

---

## Self-Review Notes

- **Spec coverage:** slot resolution + bundled defaults (Task 1), bilerp + blend math (Task 2), unlit ShaderMaterial with noise (Task 3), load/swap/dispose wiring + loading transition (Task 4), live parity checks (Task 5). PBR terrain explicitly deferred per spec.
- **Type consistency:** `resolveTerrainSlot` returns `{kind:'default',url}` / `{kind:'custom',uuid}` used identically in Tasks 1 and 4; `buildTerrainMaterial(opts)` / `setTerrainSlot(material, slot, texture)` signatures match between Tasks 3 and 4; `layerWeights`/`bilerpCorners` GLSL twins mirror the JS in Task 2.
- **Open tuning items (live, not blockers):** `uTexScale`, `uNoiseScale`, `uNoiseAmp`; exact default UUIDs (Task 1 Step 1 verification gate).
