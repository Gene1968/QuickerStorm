# Per-Face Prim Materials Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render square-box and cylinder prims with true per-face textures, tints, and per-face UV (replacing the single dominant-face MVP), and surface per-face UV in the Build Tools floater.

**Architecture:** Three's box/cylinder geometries already produce material groups that survive the worker bake. The mesh path's `buildFaceMaterials` already builds one material per group. This work adds a source-verified `group→SLface` remap (`primFaceMap`), threads it through `buildFaceMaterials`, gates prims into that path only when faces genuinely differ, and adds per-face UV display to `ObjectEditFloater`. Prism/sphere/torus/cut/hollow stay on the existing dominant-face path.

**Tech Stack:** Vue 3 + Pinia, Three.js r184, Bun test runner (`bun:test`), Vite. Tabs not spaces.

**Spec:** `docs/superpowers/specs/2026-06-08-per-face-prim-materials-design.md`

---

## File Structure

- **Create** `src/lib/primFaceMap.js` — pure: `primFaceMap(shape) → number[]|null`, `slFaceForGroup(faceMap, groupIndex) → number`, exported `BOX_FACE_MAP`/`CYL_FACE_MAP`. One responsibility: the verified face remap + gating.
- **Create** `src/__tests__/lib/primFaceMap.test.js` — unit tests for the map + resolver + gating.
- **Modify** `src/composables/useWorldEngine.js` — add `faceMap` param to `buildFaceMaterials`; add `hasMultiFacePrim(obj)` + `primFacesDiffer(obj)`; wire prims into the per-face path at the `applySwap` call site; extend the single-material/PBR gate to skip multi-face prims.
- **Create** `src/__tests__/lib/primFacesDiffer.test.js` — unit test the pure distinctness helper (kept in a small exported module to stay testable; see Task 3).
- **Modify** `src/components/ObjectEditFloater.vue` — add `faceUvRows` computed + a "Per-face mapping" subsection in the Blinn-Phong tab.

---

## Task 1: `primFaceMap` pure module

**Files:**
- Create: `src/lib/primFaceMap.js`
- Test: `src/__tests__/lib/primFaceMap.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/lib/primFaceMap.test.js`:

```js
import { describe, it, expect } from 'bun:test'
import { primFaceMap, slFaceForGroup, BOX_FACE_MAP, CYL_FACE_MAP } from '@/lib/primFaceMap.js'

const box  = { pathCurve: 16, profileCurve: 1 }   // square box
const cyl  = { pathCurve: 16, profileCurve: 0 }   // cylinder
const prism = { pathCurve: 16, profileCurve: 3 }
const sphere = { pathCurve: 32, profileCurve: 5 }
const torus  = { pathCurve: 32, profileCurve: 0 }

describe('primFaceMap', () => {
	it('square box → verified group→SLface map', () => {
		expect(primFaceMap(box)).toEqual([2, 4, 0, 5, 1, 3])
		expect(BOX_FACE_MAP).toEqual([2, 4, 0, 5, 1, 3])
	})
	it('cylinder → verified group→SLface map', () => {
		expect(primFaceMap(cyl)).toEqual([1, 0, 2])
		expect(CYL_FACE_MAP).toEqual([1, 0, 2])
	})
	it('prism / sphere / torus → null (fallback)', () => {
		expect(primFaceMap(prism)).toBeNull()
		expect(primFaceMap(sphere)).toBeNull()
		expect(primFaceMap(torus)).toBeNull()
	})
	it('null / missing shape → null', () => {
		expect(primFaceMap(null)).toBeNull()
		expect(primFaceMap({})).toBeNull()
	})
	it('hollow box → null (faces renumber)', () => {
		expect(primFaceMap({ ...box, profileHollow: 12000 })).toBeNull()
	})
	it('path-cut box → null', () => {
		expect(primFaceMap({ ...box, pathBegin: 5000 })).toBeNull()
		expect(primFaceMap({ ...box, pathEnd: 5000 })).toBeNull()
	})
	it('profile-cut cylinder → null', () => {
		expect(primFaceMap({ ...cyl, profileBegin: 5000 })).toBeNull()
		expect(primFaceMap({ ...cyl, profileEnd: 5000 })).toBeNull()
	})
})

describe('slFaceForGroup', () => {
	it('null map → identity', () => {
		expect(slFaceForGroup(null, 3)).toBe(3)
	})
	it('uses the map when present', () => {
		expect(slFaceForGroup(BOX_FACE_MAP, 0)).toBe(2)
		expect(slFaceForGroup(BOX_FACE_MAP, 2)).toBe(0)
	})
	it('out-of-range group index → identity fallback', () => {
		expect(slFaceForGroup(CYL_FACE_MAP, 9)).toBe(9)
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/__tests__/lib/primFaceMap.test.js`
Expected: FAIL — `Cannot find module '@/lib/primFaceMap.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/primFaceMap.js`:

```js
// src/lib/primFaceMap.js — pure mapping from a Three.js geometry group's materialIndex to the
// SL TextureEntry face index, for prims whose face layout we can map exactly.
//
// WHY: Three's BoxGeometry/CylinderGeometry emit material groups (box mi 0..5 = +X,-X,+Y,-Y,+Z,-Z;
// cylinder mi 0..2 = side,top,bottom), and those groups survive the worker bake. But Three's group
// order is NOT the SL face-numbering order. SL numbers faces per the LLVolume face list
// (https://wiki.secondlife.com/wiki/Face): clean box = top(+Z)0, -Y1, +X2, +Y3, -X4, bottom(-Z)5;
// cylinder = top(+Z)0, outside1, bottom(-Z)2. Composed with our axis bake (slToThree(x,y,z)=(x,z,-y)
// → Three +Y=SL +Z, +Z=SL -Y), the group→SLface arrays below result. Naming a wrong number here puts
// textures on the wrong sides, so these are frozen + unit-tested + live-verified.
//
// Only a true square box and a plain cylinder are mappable. Prism's 3 sides collapse into ONE Three
// group; triangle/half profiles render as a box (wrong face set); hollow/cut renumbers SL faces.
// All of those return null → caller keeps the dominant-face MVP.

export const BOX_FACE_MAP = [2, 4, 0, 5, 1, 3]  // group materialIndex (0..5) → SL face index
export const CYL_FACE_MAP = [1, 0, 2]            // group materialIndex (0..2) → SL face index

export function primFaceMap(shape) {
	if (!shape) return null
	// Hollow or any path/profile cut changes the SL face count + numbering → not mappable.
	// Decoder stores these as raw U16 where 0 = uncut/no-hollow (true for both raw and normalized).
	if (shape.profileHollow || shape.pathBegin || shape.pathEnd || shape.profileBegin || shape.profileEnd) {
		return null
	}
	const pc = shape.pathCurve ?? 16
	const pf = (shape.profileCurve ?? 1) & 0x0F
	if (pc === 16 && pf === 1) return BOX_FACE_MAP   // square box: 6 faces, 1:1 with groups
	if (pc === 16 && pf === 0) return CYL_FACE_MAP   // cylinder: side/top/bottom
	return null                                       // prism, triangle, sphere, torus, etc → fallback
}

// Resolve a geometry group's materialIndex to its SL face index. Identity when no map (mesh path,
// where group index already equals SL face) or when the index is outside the map.
export function slFaceForGroup(faceMap, groupIndex) {
	if (!faceMap) return groupIndex
	const f = faceMap[groupIndex]
	return f === undefined ? groupIndex : f
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/__tests__/lib/primFaceMap.test.js`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/primFaceMap.js src/__tests__/lib/primFaceMap.test.js
git commit -m "feat(render): add verified prim group→SLface map (box+cylinder)"
```

---

## Task 2: Thread `faceMap` through `buildFaceMaterials`

**Files:**
- Modify: `src/composables/useWorldEngine.js` (`buildFaceMaterials`, ~2550; import at top)

The existing `buildFaceMaterials(mesh, obj)` indexes TE data by the group's `materialIndex i`, assuming `i === SLface` (true for meshes). Add an optional `faceMap` and resolve the SL face via `slFaceForGroup`. Material array stays indexed by group `i` (so `mesh.material[i]` aligns with `group.materialIndex i`); only the **TE data source** shifts to the resolved SL face.

- [ ] **Step 1: Add the import**

At the top of `useWorldEngine.js`, next to the other `@/lib` imports (after the `movementCorrection` import added earlier):

```js
import { slFaceForGroup } from '@/lib/primFaceMap.js'
```

- [ ] **Step 2: Change the signature + resolver**

Replace the current header of `buildFaceMaterials` (the `function buildFaceMaterials(mesh, obj) {` line through the `faceXform` definition) with:

```js
	function buildFaceMaterials(mesh, obj, faceMap = null) {
		const groups = mesh.geometry?.groups
		if (!groups || !groups.length) return
		const maxIdx = groups.reduce((m, g) => Math.max(m, g.materialIndex ?? 0), 0)
		// Group materialIndex → SL TextureEntry face index. Identity for meshes (no map).
		const sf = (i) => slFaceForGroup(faceMap, i)
		const faceXform = (i) => uvXform(
			obj.faceRepeats?.[sf(i)] ?? obj.defaultRepeats,
			obj.faceOffset?.[sf(i)] ?? obj.defaultOffset,
			obj.faceRotation?.[sf(i)] ?? obj.defaultRotation,
		)
```

- [ ] **Step 3: Use the resolved SL face for color + texture lookups**

In the material-build loop, change the color lookup from `obj.faceColors?.[i]` to `obj.faceColors?.[sf(i)]`:

```js
		const mats = []
		for (let i = 0; i <= maxIdx; i++) {
			const fc = obj.faceColors?.[sf(i)] ?? obj.defaultColor
```

In the texture-apply loop, change the face-texture lookup from `obj.faceTextures?.[i]` to `obj.faceTextures?.[sf(i)]`, and the no-tint reset likewise:

```js
		for (let i = 0; i < mats.length; i++) {
			const faceTex = isRealTex(obj.faceTextures?.[sf(i)]) ? obj.faceTextures[sf(i)]
				: (isRealTex(obj.defaultTexture) ? obj.defaultTexture : null)
			if (!faceTex) continue
			const m = mats[i]
			getTexture(faceTex, faceXform(i)).then(tex => {
				if (!tex || !mesh.parent || mesh.material !== mats) return
				m.map = tex
				if (!(obj.faceColors?.[sf(i)] ?? obj.defaultColor)) m.color.set(0xffffff)
				if (tex.userData?.hasAlpha) m.alphaTest = 0.5
				m.needsUpdate = true
			})
		}
```

(Leave the array-assign + old-material dispose between the two loops untouched.)

- [ ] **Step 4: Verify the mesh path is unchanged + build**

Mesh callers still call `buildFaceMaterials(mesh, obj)` with no `faceMap` → `sf(i) === i` → identical behavior.

Run: `npm run build:staging`
Expected: `✓ built` with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/composables/useWorldEngine.js
git commit -m "feat(render): buildFaceMaterials accepts optional group→SLface map"
```

---

## Task 3: `primFacesDiffer` pure helper + test

The multi-face gate needs a "do the faces actually differ?" check. Keep the pure part in `primFaceMap.js` so it is unit-testable (it has no Three/DOM deps).

**Files:**
- Modify: `src/lib/primFaceMap.js` (add `primFacesDiffer`)
- Test: `src/__tests__/lib/primFacesDiffer.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/lib/primFacesDiffer.test.js`:

```js
import { describe, it, expect } from 'bun:test'
import { primFacesDiffer } from '@/lib/primFaceMap.js'

const REAL_A = '11111111-1111-1111-1111-111111111111'
const REAL_B = '22222222-2222-2222-2222-222222222222'
const BLANK  = '5748decc-f629-461c-9a36-a35a221fe21f'  // SL Blank texture (treated as no-tex)

describe('primFacesDiffer', () => {
	it('two distinct real textures → true', () => {
		expect(primFacesDiffer({ defaultTexture: REAL_A, faceTextures: [REAL_B] })).toBe(true)
	})
	it('same texture everywhere → false', () => {
		expect(primFacesDiffer({ defaultTexture: REAL_A, faceTextures: [REAL_A, REAL_A] })).toBe(false)
	})
	it('blank + nulls are not counted as distinct textures', () => {
		expect(primFacesDiffer({ defaultTexture: REAL_A, faceTextures: [BLANK, null] })).toBe(false)
	})
	it('two distinct tints → true', () => {
		expect(primFacesDiffer({
			defaultColor: [1, 1, 1, 1],
			faceColors: [[1, 0, 0, 1], null],
		})).toBe(true)
	})
	it('uniform tint + uniform tex → false', () => {
		expect(primFacesDiffer({ defaultColor: [1, 1, 1, 1], faceColors: [[1, 1, 1, 1]] })).toBe(false)
	})
	it('empty object → false', () => {
		expect(primFacesDiffer({})).toBe(false)
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/__tests__/lib/primFacesDiffer.test.js`
Expected: FAIL — `primFacesDiffer is not a function` / not exported.

- [ ] **Step 3: Implement `primFacesDiffer` in `src/lib/primFaceMap.js`**

Append to `src/lib/primFaceMap.js`:

```js
// SL "Blank" texture is the default no-image fill — treat as "no real texture".
const SL_BLANK = '5748decc-f629-461c-9a36-a35a221fe21f'
const ZERO_UUID = '00000000-0000-0000-0000-000000000000'
function isRealTexUuid(u) {
	return !!u && u !== ZERO_UUID && u !== SL_BLANK
}

// True when the prim's faces carry ≥2 distinct real textures OR ≥2 distinct tints. This is the
// gate for entering the (more expensive) per-face multi-material path; uniform prims stay on the
// cheap single-material path.
export function primFacesDiffer(obj) {
	if (!obj) return false
	const texSet = new Set()
	if (isRealTexUuid(obj.defaultTexture)) texSet.add(obj.defaultTexture)
	if (Array.isArray(obj.faceTextures)) for (const f of obj.faceTextures) if (isRealTexUuid(f)) texSet.add(f)
	if (texSet.size >= 2) return true
	const colKey = (c) => (Array.isArray(c) ? c.map((v) => Math.round(v * 255)).join(',') : null)
	const colSet = new Set()
	const dk = colKey(obj.defaultColor)
	if (dk) colSet.add(dk)
	if (Array.isArray(obj.faceColors)) for (const c of obj.faceColors) { const k = colKey(c); if (k) colSet.add(k) }
	return colSet.size >= 2
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/__tests__/lib/primFacesDiffer.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/primFaceMap.js src/__tests__/lib/primFacesDiffer.test.js
git commit -m "feat(render): primFacesDiffer gate for per-face prims"
```

---

## Task 4: Wire multi-face prims into the per-face path

**Files:**
- Modify: `src/composables/useWorldEngine.js` (import; `hasMultiFacePrim`; the `meshMulti` computation site; the `applySwap` `buildFaceMaterials` call ~1474; the single-material/PBR gate `primTexId` ~1521 and PBR apply ~1556)

> Line numbers are from the pre-edit file; locate by the quoted code, not the number.

- [ ] **Step 1: Extend the import from primFaceMap**

Update the import added in Task 2 to also bring in `primFaceMap` and `primFacesDiffer`:

```js
import { primFaceMap, slFaceForGroup, primFacesDiffer } from '@/lib/primFaceMap.js'
```

- [ ] **Step 2: Add `hasMultiFacePrim` next to `hasMultiFaceMesh`**

Immediately after the `hasMultiFaceMesh(obj)` function (~line 65), add:

```js
	// WHY: a square box / cylinder whose faces genuinely differ → render per-face (one material per
	// geometry group, remapped to SL face order). Excludes meshes, placeholders, and any prim whose
	// face layout we can't map exactly (primFaceMap === null). The ≥2-distinct gate keeps uniform
	// prims on the cheap single-material path.
	function hasMultiFacePrim(obj) {
		if (obj.meshId || obj._placeholder) return false
		if (!primFaceMap(obj.shape)) return false
		return primFacesDiffer(obj)
	}
```

- [ ] **Step 3: Compute `primMulti` alongside `meshMulti`**

Find where `meshMulti` is computed (the `const meshMulti = hasMultiFaceMesh(obj)` assignment, near the prim build / line ~1417–1474 region). Immediately after it add:

```js
		const primMulti = hasMultiFacePrim(obj)
```

- [ ] **Step 4: Call `buildFaceMaterials` for prims at the swap site**

Find the call site (~1474):

```js
				if (meshMulti) buildFaceMaterials(mesh, obj)
```

Replace with:

```js
				if (meshMulti) buildFaceMaterials(mesh, obj)
				else if (primMulti) buildFaceMaterials(mesh, obj, primFaceMap(obj.shape))
```

- [ ] **Step 5: Exclude multi-face prims from the single-material texture + PBR paths**

Find the `primTexId` gate (~1521):

```js
			const primTexId = (!isAvatar && !obj._placeholder && !meshMulti) ? pickPrimTexture(obj) : null
```

Replace with:

```js
			const primTexId = (!isAvatar && !obj._placeholder && !meshMulti && !primMulti) ? pickPrimTexture(obj) : null
```

Find the PBR/legacy apply guard that currently checks `!meshMulti` (~1556, the `hasMaterial && !meshMulti` style condition wrapping the single-material PBR/legacy block) and add `&& !primMulti` to it so multi-face prims don't also get a single-material PBR pass. (If the guard reads `if (hasMaterial && !meshMulti) {`, make it `if (hasMaterial && !meshMulti && !primMulti) {`.)

- [ ] **Step 6: Build + run the full unit suite**

Run: `npm run build:staging`
Expected: `✓ built`, no errors.

Run: `bun test src/__tests__/lib/primFaceMap.test.js src/__tests__/lib/primFacesDiffer.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/composables/useWorldEngine.js
git commit -m "feat(render): render box+cylinder prims per-face when faces differ"
```

- [ ] **Step 8: Live verify (user)**

In the running app: find a box with different textures per side → textures land on the correct sides (front/back/left/right/top/bottom not swapped); a multi-tint box → tints on the correct sides; a uniform-textured box → unchanged, still single-material (confirm no frame-rate regression on a dense region). If a face is consistently swapped with another, the fix is to correct the offending entry in `BOX_FACE_MAP` / `CYL_FACE_MAP` and update the Task 1 test — record the observed swap before changing numbers.

---

## Task 5: Per-face UV display in ObjectEditFloater

**Files:**
- Modify: `src/components/ObjectEditFloater.vue` (`<script setup>` computed + Blinn-Phong template section)

- [ ] **Step 1: Add the `faceUvRows` computed**

In `<script setup>`, after the `faceTexChips` computed (~line 246), add:

```js
	// Per-face UV overrides: a face appears only if it overrides repeats, offset, OR rotation.
	// Resolved values fall back to the prim default for any axis the face does not override.
	const faceUvRows = computed(() => {
		const o = obj.value
		if (!o) return []
		const rep = o.faceRepeats ?? [], off = o.faceOffset ?? [], rot = o.faceRotation ?? []
		const n = Math.max(rep.length, off.length, rot.length)
		const rows = []
		for (let i = 0; i < n; i++) {
			const hasOverride = rep[i] != null || off[i] != null || rot[i] != null
			if (!hasOverride) continue
			rows.push({
				face: i,
				repeats: rep[i] ?? o.defaultRepeats ?? [1, 1],
				offset:  off[i] ?? o.defaultOffset ?? [0, 0],
				rotation: rot[i] ?? o.defaultRotation ?? 0,
			})
		}
		return rows
	})
```

- [ ] **Step 2: Add the "Per-face mapping" subsection to the template**

In the Blinn-Phong template block, immediately after the per-face textures section (the `<div v-if="faceTexChips.length" ...>` block ending around line 644) and before the `<!-- Mapping (default face) -->` block, add:

```html
					<!-- Per-face UV overrides -->
					<div v-if="faceUvRows.length" class="border-t border-brd pt-2">
						<div class="text-white/50 text-2xs uppercase tracking-wide mb-1">Per-face mapping</div>
						<div class="space-y-1">
							<div v-for="r in faceUvRows" :key="r.face" class="grid grid-cols-[2rem,1fr] gap-x-2 items-center text-2xs">
								<span class="text-white/50">F{{ r.face }}</span>
								<div class="font-mono text-t1">
									{{ r.repeats[0].toFixed(2) }}×{{ r.repeats[1].toFixed(2) }}
									· off {{ r.offset[0].toFixed(2) }},{{ r.offset[1].toFixed(2) }}
									· {{ (r.rotation * 180 / Math.PI).toFixed(0) }}°
								</div>
							</div>
						</div>
					</div>
```

- [ ] **Step 3: Build**

Run: `npm run build:staging`
Expected: `✓ built`, no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/ObjectEditFloater.vue
git commit -m "feat(ui): show per-face UV overrides in Build Tools texture tab"
```

- [ ] **Step 5: Live verify (user)**

Select a multi-face prim → Texture tab → "Per-face mapping" lists the overriding faces with repeats/offset/rotation matching what the renderer applies. A uniform prim shows no per-face sections.

---

## Final verification

- [ ] Run the full client lib suite: `bun test src/__tests__/lib/` → all pass.
- [ ] `npm run build:staging` → `✓ built`.
- [ ] Live: per-face box/cylinder render correct sides; uniform prims unchanged; floater per-face UV correct; no perf regression on a dense region.
- [ ] Update memory `render-pipeline-state` "Full per-face multi-material" open item → done for box+cylinder, prism deferred (custom geometry).
