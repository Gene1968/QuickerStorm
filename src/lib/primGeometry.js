// src/lib/primGeometry.js — shared prim/mesh geometry helpers used by the world engine and workers.
import * as THREE from 'three'
import { buildPrimMeshArrays } from '@/lib/primMesher.js'

// WHY: cache-buster for the persistent baked-geometry cache (qs-geom). Bump whenever any
// function in this file changes its OUTPUT for the same inputs (new deform support, segment
// count changes, axis-map fixes…). Old entries become unreachable and age out via LRU.
// v2: real PrimMesher tessellation (hollow/cut/twist/taper/shear/radius/revolutions/skew)
// replaces the Three.js-primitive stand-ins.
// v3: linear-prim cap UVs match FS LLVolume (top v=y+0.5, bottom v=0.5-y) — caps were upside-down.
// v4: side-face V matches FS (V runs with the path, 0 bottom → 1 top) — sides were upside-down too.
export const GEOM_VERSION = 4

// WHY: tessellate an SL prim from its full shape via the PrimMesher port (src/lib/primMesher.js),
// faithful to OpenSim's Meshmerizer. Replaces the old Box/Cylinder/Sphere/Torus stand-ins so
// hollow, profile cut, path cut, hole size, twist, taper, top shear, radius offset, revolutions
// and skew all render correctly. The mesher returns SL-space triangle soup with a per-triangle SL
// face number; here we convert SL→Three (slToThree(x,y,z)=(x,z,−y)), preserve the mesher's
// per-vertex normals (so flat box faces stay flat and round faces stay smooth), and emit one
// geometry group per SL face — compacted to a contiguous 0..N-1 materialIndex so the per-face
// texture path (buildFaceMaterials) can index TextureEntry by group materialIndex directly, the
// same identity contract as the mesh path. bakePrimScale() then bakes sx/sy/sz into the geometry.
export function buildPrimGeometry(shape, opts) {
	const a = buildPrimMeshArrays(shape, opts)
	const triCount = a.faceNumbers.length
	const geom = new THREE.BufferGeometry()
	if (triCount === 0) return geom   // degenerate shape → caller's finite-verts guard substitutes a placeholder

	// Compact the mesher's (possibly gappy) SL face numbers to contiguous 0..N-1, then order the
	// triangles by face so each face is one contiguous group.
	const uniq = [...new Set(a.faceNumbers)].sort((x, y) => x - y)
	const remap = new Map(uniq.map((f, i) => [f, i]))
	const order = [...Array(triCount).keys()].sort(
		(i, j) => (remap.get(a.faceNumbers[i]) - remap.get(a.faceNumbers[j])) || (i - j),
	)

	const pos = new Float32Array(triCount * 9)
	const nor = new Float32Array(triCount * 9)
	const uv = new Float32Array(triCount * 6)
	let curFace = -1, groupStart = 0
	for (let t = 0; t < triCount; t++) {
		const src = order[t]
		for (let k = 0; k < 3; k++) {
			const so = src * 9 + k * 3, su = src * 6 + k * 2, d = (t * 3 + k) * 3, du = (t * 3 + k) * 2
			// slToThree: Three (x = SL x, y = SL z, z = −SL y)
			pos[d] = a.positions[so]; pos[d + 1] = a.positions[so + 2]; pos[d + 2] = -a.positions[so + 1]
			nor[d] = a.normals[so]; nor[d + 1] = a.normals[so + 2]; nor[d + 2] = -a.normals[so + 1]
			uv[du] = a.uvs[su]; uv[du + 1] = a.uvs[su + 1]
		}
		const cf = remap.get(a.faceNumbers[src])
		if (cf !== curFace) {
			if (curFace !== -1) geom.addGroup(groupStart, t * 3 - groupStart, curFace)
			curFace = cf; groupStart = t * 3
		}
	}
	if (curFace !== -1) geom.addGroup(groupStart, triCount * 3 - groupStart, curFace)

	geom.setAttribute('position', new THREE.BufferAttribute(pos, 3))
	geom.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
	geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
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
