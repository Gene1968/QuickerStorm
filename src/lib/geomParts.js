// src/lib/geomParts.js
import * as THREE from 'three'

// Split a baked BufferGeometry into one sub-geometry per material group, so each
// face-group can be rendered by its own InstancedMesh (InstancedMesh takes a single
// material, not a material array). Single-group geometry passes through unchanged.
// Each multi-group part is COMPACTED (only its referenced vertices, re-indexed) so
// parts share no attribute buffers — disposal is independent and hazard-free.
// WHY: per-face material arrays are ~48% of draw calls; decomposing them is the
// only way to instance multi-material mesh assets. See spec draw-call-instancing.
export function splitParts(geometry) {
	const groups = geometry.groups
	if (!groups || groups.length <= 1) {
		return [{ materialIndex: groups?.[0]?.materialIndex ?? 0, geometry }]
	}
	// A materialIndex may span several non-contiguous index ranges — merge them.
	const ranges = new Map()
	for (const g of groups) {
		if (!ranges.has(g.materialIndex)) ranges.set(g.materialIndex, [])
		ranges.get(g.materialIndex).push([g.start, g.count])
	}
	const parts = []
	for (const [materialIndex, rs] of ranges) {
		parts.push({ materialIndex, geometry: compact(geometry, rs) })
	}
	return parts
}

function compact(src, ranges) {
	const pos = src.getAttribute('position')
	const nor = src.getAttribute('normal')
	const uv = src.getAttribute('uv')
	const srcIdx = src.getIndex().array
	const remap = new Map()
	const nPos = [], nNor = [], nUv = [], nIdx = []
	for (const [start, count] of ranges) {
		for (let i = start; i < start + count; i++) {
			const vi = srcIdx[i]
			let ni = remap.get(vi)
			if (ni === undefined) {
				ni = remap.size
				remap.set(vi, ni)
				nPos.push(pos.getX(vi), pos.getY(vi), pos.getZ(vi))
				if (nor) nNor.push(nor.getX(vi), nor.getY(vi), nor.getZ(vi))
				if (uv) nUv.push(uv.getX(vi), uv.getY(vi))
			}
			nIdx.push(ni)
		}
	}
	const g = new THREE.BufferGeometry()
	g.setAttribute('position', new THREE.Float32BufferAttribute(nPos, 3))
	if (nor) g.setAttribute('normal', new THREE.Float32BufferAttribute(nNor, 3))
	if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(nUv, 2))
	g.setIndex(nIdx)
	g.computeBoundingSphere()
	return g
}
