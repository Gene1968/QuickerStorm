// src/lib/slSkeleton.js — live SL avatar skeleton + runtime skinning (bundle 7·D).
//
// Builds a THREE.Bone hierarchy from the FS avatar_skeleton.xml table (shared/slSkeletonDef.js:
// 133 bones + 26 collision volumes, Bento). Bones live in the SL AVATAR frame (x fwd, y left,
// z up, metres, ground origin — the frame every mesh inverse-bind matrix and .anim key expects);
// the skeleton ROOT group does the one SL→Three conversion (R_x(−90°), same permutation as
// slToThree(x,y,z)=(x,z,−y)) and drops the feet to the −RIG_FOOT_OFFSET ground contract, so a
// bone's matrixWorld = avatarNodeWorld · conv · slJointWorld — exactly what a SkinnedMesh bound
// with the SL matrices needs.
//
// Matrix conventions: SL/FS matrices are row-major row-vector (v' = v·M). THREE.Matrix4.fromArray
// reads column-major, so feeding the 16 SL floats straight in IS the row→column-vector transpose —
// no explicit transpose anywhere. The FS rest-pose identity (meshSkin.ts, AV-1):
//     v·bind_shape·Σ wₖ·(invBindₖ·jointWorldₖ)          (row-vector)
// becomes THREE's skinning
//     Σ wₖ·(boneWorldₖ·boneInverseₖ)·bindMatrix·v       (column-vector)
// with boneInverseₖ = fromArray(invBindₖ) and bindMatrix = fromArray(bind_shape). SkinnedMesh's
// default 'attached' bindMode recomputes bindMatrixInverse = mesh.matrixWorld⁻¹ per frame, so the
// mesh node's own transform cancels — placement is 100% bone-driven.
import * as THREE from 'three'
import { BONES, COLLISION_VOLUMES } from '@shared/slSkeletonDef.js'

const DEG = Math.PI / 180

// SL avatar frame → Three: (x, y, z) → (x, z, −y) = rotate −90° about X.
export const SL_TO_THREE_QUAT = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0))
export const THREE_TO_SL_QUAT = SL_TO_THREE_QUAT.clone().invert()

function makeBone([name, , px, py, pz, rx, ry, rz, sx, sy, sz]) {
	const b = new THREE.Bone()
	b.name = name
	b.position.set(px, py, pz)
	// Rest rotation (degrees) — zero for every real bone; collision volumes carry small ones.
	// SL euler composes about fixed axes X→Y→Z = three.js intrinsic 'ZYX' (attachmentPoints.js).
	if (rx || ry || rz) b.quaternion.setFromEuler(new THREE.Euler(rx * DEG, ry * DEG, rz * DEG, 'ZYX'))
	b.scale.set(sx, sy, sz)
	// Rest pose snapshot — the anim player restores un-animated joints from these each frame.
	b.userData.restPos = b.position.clone()
	b.userData.restQuat = b.quaternion.clone()
	return b
}

/**
 * Build one live SL skeleton. Returns { root, bones, boneList }:
 *   root     — Group to add under the avatar node (carries the SL→Three conversion + foot drop)
 *   bones    — Map<jointName, THREE.Bone> (bones AND collision volumes — fitted mesh rigs to both)
 *   boneList — bones in table order (parents first)
 * Collision volumes are plain child bones here (no children of their own) so meshes can weight
 * to them; they are excluded from animation (only .anim joint names land on them if a rig asks).
 */
export function createSLSkeleton(footOffset) {
	const bones = new Map()
	const boneList = []
	for (const def of BONES) {
		const b = makeBone(def)
		const parentIdx = def[1]
		if (parentIdx >= 0) boneList[parentIdx].add(b)
		boneList.push(b)
		bones.set(b.name, b)
	}
	for (const def of COLLISION_VOLUMES) {
		const v = makeBone(def)
		boneList[def[1]].add(v)
		bones.set(v.name, v)
	}
	const root = new THREE.Group()
	root.name = 'slSkeletonRoot'
	root.quaternion.copy(SL_TO_THREE_QUAT)
	root.position.y = -footOffset   // SL ground origin → avatar-node feet (AV-1 contract)
	root.add(boneList[0])           // mPelvis chain
	return { root, bones, boneList }
}

/**
 * Merge raw rigged submeshes (SL bind-space, straight from the :skin mesh lane) into ONE
 * BufferGeometry with skinning attributes. NO axis swap and NO bind_shape application — geometry
 * stays in the mesh's own bind space; bindMatrix + the skeleton do the whole placement. Groups
 * mirror swapSubmeshesToGeometry (materialIndex = submesh index) so per-face materials
 * (buildFaceMaterials) work unchanged.
 */
export function mergeSkinnedGeometry(subs) {
	let vTotal = 0, iTotal = 0
	for (const s of subs) { vTotal += s.positions.length / 3; iTotal += s.indices.length }
	const pos = new Float32Array(vTotal * 3), nor = new Float32Array(vTotal * 3), uv = new Float32Array(vTotal * 2)
	const sIdx = new Uint16Array(vTotal * 4), sWgt = new Float32Array(vTotal * 4)
	const idx = new Uint32Array(iTotal)
	const g = new THREE.BufferGeometry()
	let vOff = 0, iOff = 0
	for (let gi = 0; gi < subs.length; gi++) {
		const s = subs[gi]
		const v = s.positions.length / 3
		pos.set(s.positions, vOff * 3)
		nor.set(s.normals, vOff * 3)
		uv.set(s.uvs, vOff * 2)
		const ji = s.jointIndices, jw = s.jointWeights
		for (let k = 0; k < v; k++) {
			let sum = 0
			if (ji && jw) {
				for (let t = 0; t < 4; t++) {
					sIdx[(vOff + k) * 4 + t] = ji[k * 4 + t]
					const w = jw[k * 4 + t]
					sWgt[(vOff + k) * 4 + t] = w
					sum += w
				}
			}
			// Zero-weight vertex → 100% joint 0 (FS llvolume.cpp:2600 fallback) so it lands ON the
			// body instead of collapsing to the origin (Σ wₖMₖ = 0 in the shader otherwise).
			if (sum <= 0) { sIdx[(vOff + k) * 4] = 0; sWgt[(vOff + k) * 4] = 1 }
		}
		for (let t = 0; t < s.indices.length; t++) idx[iOff + t] = s.indices[t] + vOff
		g.addGroup(iOff, s.indices.length, gi)
		vOff += v; iOff += s.indices.length
	}
	g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
	g.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
	g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
	g.setAttribute('skinIndex', new THREE.BufferAttribute(sIdx, 4))
	g.setAttribute('skinWeight', new THREE.BufferAttribute(sWgt, 4))
	g.setIndex(new THREE.BufferAttribute(idx, 1))
	return g
}

/**
 * Bind a SkinnedMesh to the avatar's live skeleton using the mesh's own rig block. Each mesh gets
 * its OWN THREE.Skeleton (its inverse-bind set) wrapping the SHARED bones — skinIndex values index
 * skin.jointNames order. Joints our skeleton lacks map to mPelvis (server skinDbg flags them).
 */
export function bindToSkeleton(mesh, skel, skin) {
	const pelvis = skel.bones.get('mPelvis')
	const bones = skin.jointNames.map(n => skel.bones.get(n) || pelvis)
	const inverses = skin.jointNames.map((n, k) => {
		const m = skin.inverseBindMatrix[k]
		return (m && m.length === 16) ? new THREE.Matrix4().fromArray(m) : new THREE.Matrix4()
	})
	const bindMatrix = (skin.bindShapeMatrix && skin.bindShapeMatrix.length === 16)
		? new THREE.Matrix4().fromArray(skin.bindShapeMatrix)
		: new THREE.Matrix4()
	mesh.bind(new THREE.Skeleton(bones, inverses), bindMatrix)
	// Skinned bounds live wherever the bones are, not at the mesh node — cull by the avatar instead.
	mesh.frustumCulled = false
}
