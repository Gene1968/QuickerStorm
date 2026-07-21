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
	// Rest pose snapshot — the anim player restores un-animated joints from these each frame. restPos is
	// LIVE (mesh joint-position overrides rewrite it so anims re-anchor); defaultPos is the immutable
	// avatar_skeleton.xml value, kept for the FS aboveJointPosThreshold() override-vs-default compare.
	b.userData.restPos = b.position.clone()
	b.userData.restQuat = b.quaternion.clone()
	b.userData.defaultPos = b.position.clone()
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
	// 7·D joint-position overrides: which worn mesh (by id) owns each joint's override (first-wins), and
	// whether a pelvis Z fixup has been applied yet (applied once, to the root, so it survives re-skins).
	return { root, bones, boneList, footOffset, overrideBy: new Map(), pelvisFixupBy: null }
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

// FS LLJoint::aboveJointPosThreshold — 0.1 mm (LL_JOINT_TRESHOLD_POS_OFFSET); an override under this from
// the joint's avatar_skeleton.xml default is ignored (jitter guard, and keeps default bones un-touched).
const JOINT_POS_THRESHOLD = 1e-4
const JOINT_POS_THRESHOLD_SQ = JOINT_POS_THRESHOLD * JOINT_POS_THRESHOLD
// Sanity clamp: no real avatar joint sits this far from its default LOCAL position (limbs deviate cm, the
// tallest bodies < ~0.5 m). Some attachment rigs ship a garbage/non-joint-position matrix for joints they
// list but don't drive (live: hand meshes carrying a 9.6 m mPelvis "position") — applying it would fling the
// joint. FS trusts the exporter; we reject the implausible so one bad attachment can't wreck the skeleton.
const MAX_JOINT_POS_DEVIATION = 2.0
const MAX_JOINT_POS_DEVIATION_SQ = MAX_JOINT_POS_DEVIATION * MAX_JOINT_POS_DEVIATION

/**
 * Apply a worn mesh's joint-position overrides + pelvis fixup to the shared avatar skeleton (7·D).
 * Mesh bodies ship their intended LOCAL joint positions in the skin block's alt_inverse_bind_matrix
 * (translation column) plus a pelvis_offset; ignoring them skins the body to the DEFAULT SL joint
 * layout, so a body rigged with e.g. a lower pelvis / longer legs renders mis-proportioned. FS port:
 * llvoavatar.cpp collectJointStateOverrides / addAttachmentOverridesForObject (7719-7806):
 *   • only when altInverseBindMatrix is present and one-per-joint (bindCnt == jointCnt),
 *   • per joint, jointPos = altInverseBindMatrix[i].getTranslation() (row-major row 3 = floats 12/13/14),
 *     applied via LLJoint::setPosition only if aboveJointPosThreshold(jointPos) vs the default,
 *   • pelvis_offset is a vertical (avatar Z) fixup — applied to the skeleton root so it lifts/lowers the
 *     whole avatar (matches FS addPelvisFixup) and survives per-mesh re-skins.
 * Overrides land on bone.position AND bone.userData.restPos so the AnimPlayer re-anchors joints to the
 * mesh's layout (it never touches bone.scale — pure translation, no THREE scale-cascade to fight).
 * First mesh to claim a joint wins (a body sets the full set; a later shoe won't fight it). Returns
 * { has, applied, below, rejected, claimed, pelvis } for observability (has = alt matrices present).
 */
export function applyMeshJointOverrides(skel, skin, meshId) {
	const r = { has: false, applied: 0, below: 0, rejected: 0, claimed: 0, pelvis: 0 }
	if (!skel || !skin) return r
	const alt = skin.altInverseBindMatrix
	const names = skin.jointNames
	if (!Array.isArray(alt) || !Array.isArray(names) || !alt.length || alt.length !== names.length) {
		// Still honour a pelvis fixup a rig may carry without per-joint overrides.
		r.pelvis = applyPelvisFixup(skel, skin, meshId)
		return r
	}
	r.has = true
	for (let i = 0; i < names.length; i++) {
		const name = names[i]
		const bone = skel.bones.get(name)
		const m = alt[i]
		if (!bone || !m || m.length !== 16) continue
		const px = m[12], py = m[13], pz = m[14]   // row-major translation (FS LLMatrix4::getTranslation)
		if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) { r.rejected++; continue }
		const d = bone.userData.defaultPos
		const dx = px - d.x, dy = py - d.y, dz = pz - d.z
		const distSq = dx * dx + dy * dy + dz * dz
		if (distSq <= JOINT_POS_THRESHOLD_SQ) { r.below++; continue }         // below threshold → keep default
		if (distSq > MAX_JOINT_POS_DEVIATION_SQ) { r.rejected++; continue }   // garbage/non-joint matrix → skip
		const owner = skel.overrideBy.get(name)
		if (owner && owner !== meshId) { r.claimed++; continue }              // another mesh already owns it
		bone.position.set(px, py, pz)
		bone.userData.restPos.copy(bone.position)                            // anims re-anchor to the override
		skel.overrideBy.set(name, meshId)
		r.applied++
	}
	r.pelvis = applyPelvisFixup(skel, skin, meshId)
	return r
}

// pelvis_offset → vertical lift of the whole skeleton (FS addPelvisFixup). SL +Z (up) maps to Three +Y
// (root carries the SL→Three rotation), so it adds straight to root.position.y. First mesh with a non-zero
// offset wins; applied to the root (not the pelvis bone) so a joint-override re-skin can't wipe it.
function applyPelvisFixup(skel, skin, meshId) {
	const off = Number(skin.pelvisOffset) || 0
	if (!off || skel.pelvisFixupBy != null || Math.abs(off) > MAX_JOINT_POS_DEVIATION) return 0
	skel.root.position.y = -skel.footOffset + off
	skel.pelvisFixupBy = meshId
	return off
}
