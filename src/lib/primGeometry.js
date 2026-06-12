// src/lib/primGeometry.js — shared prim/mesh geometry helpers used by the world engine and workers.
import * as THREE from 'three'

// WHY: cache-buster for the persistent baked-geometry cache (qs-geom). Bump whenever any
// function in this file changes its OUTPUT for the same inputs (new deform support, segment
// count changes, axis-map fixes…). Old entries become unreachable and age out via LRU.
export const GEOM_VERSION = 1

// WHY: Map SL prim PathCurve+ProfileCurve to a Three.js geometry. Reference table
// (libomv Primitive.cs PrimType): box/cylinder/prism use PathCurve=16 (Line);
// sphere/torus/tube/ring use PathCurve=32 (Circle). ProfileCurve low nibble: 0=Circle,
// 1=Square, 2=IsoTri, 3=EqualTri, 4=RightTri, 5=HalfCircle. Default unit-scale geometry;
// bakePrimScale() then bakes the prim's sx/sy/sz into the geometry. Hollow deferred to Phase 3
// (true CSG needed); Twist + Taper applied as per-vertex deformation below.
export function buildPrimGeometry(shape) {
	const pc = shape?.pathCurve ?? 16
	const pf = (shape?.profileCurve ?? 1) & 0x0F
	let geom
	if (pc === 16) {
		// HeightSegments=8 so Twist/Taper deformation has enough vertices to look smooth.
		if (pf === 0)      geom = new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8)
		else if (pf === 3) geom = new THREE.CylinderGeometry(0.5, 0.5, 1, 3, 8)   // prism
		else               geom = new THREE.BoxGeometry(1, 1, 1, 2, 8, 2)
	} else if (pc === 32 || pc === 33) {
		if (pf === 5) geom = new THREE.SphereGeometry(0.5, 16, 12)
		// torus / tube / ring — Three TorusGeometry stand-in; full profile sweep is Phase 3
		else          geom = new THREE.TorusGeometry(0.35, 0.15, 12, 24)
	} else {
		geom = new THREE.BoxGeometry(1, 1, 1, 2, 8, 2)
	}
	return applyShapeDeformation(geom, shape)
}

// WHY: SL Twist + Taper applied per-vertex. Twist rotates around the path axis (Three.js
// local Y for our PathCurve=16/32 geometries) by an angle that lerps from PathTwistBegin
// at the bottom to PathTwist at the top. Taper shrinks XZ scale linearly from bottom to
// top. Both encoded as S8 with 0.01 quantization (libomv Primitive.cs TWIST_QUANTA).
// Skip torus (PathCurve=32 + non-half-circle profile) — deformation doesn't follow the
// same axis convention and would mangle the geometry.
export function applyShapeDeformation(geom, shape) {
	if (!shape) return geom
	const pc = shape.pathCurve ?? 16
	const isTorusLike = (pc === 32 || pc === 33) && (shape.profileCurve & 0x0F) !== 5
	if (isTorusLike) return geom
	const twist      = (shape.pathTwist      || 0) * 0.01   // turns: -1..1
	const twistBegin = (shape.pathTwistBegin || 0) * 0.01
	const taperX     = (shape.pathTaperX     || 0) * 0.01
	const taperY     = (shape.pathTaperY     || 0) * 0.01
	if (twist === 0 && twistBegin === 0 && taperX === 0 && taperY === 0) return geom
	const pos = geom.attributes.position
	const TWO_PI = Math.PI * 2
	for (let i = 0; i < pos.count; i++) {
		let x = pos.getX(i)
		const y = pos.getY(i)
		let z = pos.getZ(i)
		// t in [0, 1] from bottom (y=-0.5) to top (y=+0.5)
		const t = y + 0.5
		// Taper: pinches/expands at top (positive value = narrow at top, SL convention)
		const sX = 1 - t * taperX
		const sZ = 1 - t * taperY
		x *= sX
		z *= sZ
		// Twist: rotation around Y axis, lerps begin → end across height
		const angle = ((1 - t) * twistBegin + t * twist) * TWO_PI
		if (angle !== 0) {
			const ca = Math.cos(angle)
			const sa = Math.sin(angle)
			const xr = x * ca - z * sa
			const zr = x * sa + z * ca
			pos.setXYZ(i, xr, y, zr)
		} else {
			pos.setXYZ(i, x, y, z)
		}
	}
	pos.needsUpdate = true
	geom.computeVertexNormals()
	return geom
}

// WHY: Bake the prim's SL scale into its GEOMETRY so the mesh node scale stays (1,1,1). Linked
// children attach to the parent mesh in the Three.js graph and would otherwise inherit the parent's
// scale — and a non-uniform parent scale does not commute with a rotated child, shearing the child
// into a region-spanning slab. SL never inherits scale across a link, so the parent's scale must
// not enter the transform chain at all. Axis map matches slToThree magnitude: Three (x=sx,y=sz,z=sy).
export function bakePrimScale(geom, scale) {
	if (scale) geom.scale(scale[0], scale[2], scale[1])
	return geom
}

// Concatenate decoded submeshes (SL-space verts) into one THREE.BufferGeometry, converting SL→Three
// (slToThree(x,y,z)=(x,z,-y), a pure 90° X rotation so winding is preserved) and baking prim scale.
// Shared by the mesh (ExtraParam type 5) and legacy-sculpt (types 1-4) paths. Returns the baked geom.
export function swapSubmeshesToGeometry(subs, scale) {
	let vTotal = 0, iTotal = 0
	for (const s of subs) { vTotal += s.positions.length / 3; iTotal += s.indices.length }
	const pos = new Float32Array(vTotal * 3), nor = new Float32Array(vTotal * 3), uv = new Float32Array(vTotal * 2)
	const idx = new Uint32Array(iTotal)
	let vOff = 0, iOff = 0
	const g = new THREE.BufferGeometry()
	for (let gi = 0; gi < subs.length; gi++) {
		const s = subs[gi]
		const v = s.positions.length / 3
		for (let k = 0; k < v; k++) {
			pos[(vOff + k) * 3 + 0] = s.positions[k * 3 + 0]    // x
			pos[(vOff + k) * 3 + 1] = s.positions[k * 3 + 2]    // y ← SL z
			pos[(vOff + k) * 3 + 2] = -s.positions[k * 3 + 1]   // z ← -SL y
			nor[(vOff + k) * 3 + 0] = s.normals[k * 3 + 0]
			nor[(vOff + k) * 3 + 1] = s.normals[k * 3 + 2]
			nor[(vOff + k) * 3 + 2] = -s.normals[k * 3 + 1]
			uv[(vOff + k) * 2 + 0] = s.uvs[k * 2 + 0]
			uv[(vOff + k) * 2 + 1] = s.uvs[k * 2 + 1]
		}
		for (let t = 0; t < s.indices.length; t++) idx[iOff + t] = s.indices[t] + vOff
		g.addGroup(iOff, s.indices.length, gi)
		vOff += v; iOff += s.indices.length
	}
	g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
	g.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
	g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
	g.setIndex(new THREE.BufferAttribute(idx, 1))
	return bakePrimScale(g, scale)
}

// WHY: a NaN/Inf vertex (bad shape-param deformation, degenerate mesh decode, etc.) makes
// computeBoundingSphere produce a NaN radius → Three.js frustum-cull test fails → the mesh is
// SILENTLY DROPPED from rendering, leaving only "Computed radius is NaN" console spam. classifySafety
// only validates pos/scale, not the built vertices, so this slips through. Scan the final positions
// and report so the caller can substitute a visible placeholder instead of an invisible prim.
export function geometryHasFiniteVerts(geom) {
	const a = geom.attributes?.position?.array
	if (!a || a.length === 0) return false
	for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false
	return true
}

// Extract a baked BufferGeometry into plain transferable arrays for postMessage.
export function extractGeomArrays(geom) {
	const pos = geom.attributes.position
	const nor = geom.attributes.normal
	const uv  = geom.attributes.uv
	const idx = geom.index
	return {
		position: pos ? pos.array : undefined,
		normal:   nor ? nor.array : undefined,
		uv:       uv  ? uv.array  : undefined,
		index:    idx ? idx.array : undefined,
		groups:   geom.groups.map(g => ({ start: g.start, count: g.count, materialIndex: g.materialIndex })),
	}
}

// Rebuild a BufferGeometry from extractGeomArrays output (cheap — no per-vertex loop).
export function geometryFromArrays(a) {
	const g = new THREE.BufferGeometry()
	if (a.position) g.setAttribute('position', new THREE.BufferAttribute(a.position, 3))
	if (a.normal)   g.setAttribute('normal',   new THREE.BufferAttribute(a.normal, 3))
	if (a.uv)       g.setAttribute('uv',       new THREE.BufferAttribute(a.uv, 2))
	if (a.index)    g.setIndex(new THREE.BufferAttribute(a.index, 1))
	if (a.groups) for (const grp of a.groups) g.addGroup(grp.start, grp.count, grp.materialIndex)
	return g
}

// Bake a single job to plain arrays (shared by worker and the sync fallback).
// job: { kind:'prim', shape, scale } | { kind:'submesh', subs, scale }
export function bakeJob(job) {
	const geom = job.kind === 'submesh'
		? swapSubmeshesToGeometry(job.subs, job.scale)
		: bakePrimScale(buildPrimGeometry(job.shape), job.scale)
	if (!geometryHasFiniteVerts(geom)) { geom.dispose?.(); return { bad: true } }
	const arrays = extractGeomArrays(geom)
	geom.dispose?.()
	return arrays
}
