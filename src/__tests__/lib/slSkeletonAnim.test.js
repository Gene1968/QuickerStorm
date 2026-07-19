// 7·D: live SL skeleton + anim playback — pins the frame conversion, runtime-skinning inputs,
// and the FS-ish per-joint priority/ease blend semantics (animPlayer.js).
import { describe, it, expect } from 'bun:test'
import * as THREE from 'three'
import { createSLSkeleton, mergeSkinnedGeometry, SL_TO_THREE_QUAT } from '@/lib/slSkeleton.js'
import { AnimPlayer, registerAnim, hasAnim } from '@/lib/animPlayer.js'
import { BONES, COLLISION_VOLUMES } from '@shared/slSkeletonDef.js'

const FOOT = 0.9

describe('createSLSkeleton', () => {
	it('builds the full Bento table (133 bones + 26 collision volumes) with rest snapshots', () => {
		const skel = createSLSkeleton(FOOT)
		expect(BONES.length).toBe(133)
		expect(COLLISION_VOLUMES.length).toBe(26)
		expect(skel.bones.size).toBe(133 + 26)
		expect(skel.bones.get('mPelvis').userData.restPos.z).toBe(1.067)   // SL-frame local rest (z up)
		expect(skel.bones.get('mPelvis').position.z).toBe(1.067)
	})

	it('bone rest WORLD positions land where the AV-1 joint table says (SL→Three at the root)', () => {
		const skel = createSLSkeleton(FOOT)
		const holder = new THREE.Group()
		holder.add(skel.root)
		holder.updateMatrixWorld(true)
		// mChest SL world = (-0.015, 0, 1.356) → three (x, z−foot, −y) = (-0.015, 0.456, 0)
		const chest = new THREE.Vector3()
		skel.bones.get('mChest').getWorldPosition(chest)
		expect(chest.x).toBeCloseTo(-0.015, 5)
		expect(chest.y).toBeCloseTo(1.356 - FOOT, 5)
		expect(chest.z).toBeCloseTo(0, 5)
		// mWristLeft SL (-0.036, 0.617, 1.521) → three (-0.036, 0.621, -0.617)
		const wrist = new THREE.Vector3()
		skel.bones.get('mWristLeft').getWorldPosition(wrist)
		expect(wrist.x).toBeCloseTo(-0.036, 5)
		expect(wrist.y).toBeCloseTo(1.521 - FOOT, 5)
		expect(wrist.z).toBeCloseTo(-0.617, 5)
	})

	it('SL_TO_THREE_QUAT is the slToThree permutation (x,y,z)→(x,z,−y)', () => {
		const v = new THREE.Vector3(1, 2, 3).applyQuaternion(SL_TO_THREE_QUAT)
		expect(v.x).toBeCloseTo(1, 6)
		expect(v.y).toBeCloseTo(3, 6)
		expect(v.z).toBeCloseTo(-2, 6)
	})
})

describe('mergeSkinnedGeometry', () => {
	const sub = (over = {}) => ({
		positions: new Float32Array([0, 0, 0, 1, 0, 0]),
		normals: new Float32Array([0, 0, 1, 0, 0, 1]),
		uvs: new Float32Array([0, 0, 1, 1]),
		indices: new Uint16Array([0, 1, 0]),
		jointIndices: new Uint8Array([2, 0, 0, 0, 3, 0, 0, 0]),
		jointWeights: new Float32Array([1, 0, 0, 0, 0.5, 0.5, 0, 0]),
		...over,
	})

	it('concats submeshes with per-submesh groups and skin attributes', () => {
		const g = mergeSkinnedGeometry([sub(), sub()])
		expect(g.attributes.position.count).toBe(4)
		expect(g.attributes.skinIndex.itemSize).toBe(4)
		expect(g.attributes.skinWeight.itemSize).toBe(4)
		expect(g.groups.length).toBe(2)
		expect(g.groups[1].materialIndex).toBe(1)
		expect(g.index.array[3]).toBe(2)   // second submesh indices offset by its vertex base
		expect(g.attributes.skinIndex.array[0]).toBe(2)
	})

	it('zero-weight vertices fall back to 100% joint 0 (FS llvolume.cpp:2600)', () => {
		const g = mergeSkinnedGeometry([sub({
			jointIndices: new Uint8Array(8),
			jointWeights: new Float32Array(8),   // all zero → would collapse in the shader
		})])
		expect(g.attributes.skinWeight.array[0]).toBe(1)
		expect(g.attributes.skinIndex.array[0]).toBe(0)
	})
})

// ── animPlayer ──────────────────────────────────────────────────────────────────────────────
const bonesFor = (...names) => {
	const m = new Map()
	for (const n of names) {
		const b = new THREE.Bone()
		b.name = n
		b.userData.restPos = new THREE.Vector3(0, 0, 1)
		b.userData.restQuat = new THREE.Quaternion()
		b.position.copy(b.userData.restPos)
		m.set(n, b)
	}
	return m
}

const rot90Z = [0, 0, Math.SQRT1_2, Math.SQRT1_2]   // quat for +90° about Z (SL frame)

const makeDef = (over = {}, joints) => ({
	version: 1, subVersion: 0, basePriority: 2, duration: 1, emoteName: '',
	loopIn: 0, loopOut: 1, loop: true, easeIn: 0, easeOut: 0, handPose: 0,
	joints: joints ?? [{
		name: 'mPelvis', priority: -1,
		rotKeys: [[0, 0, 0, 0, 1], [1, ...rot90Z]],
		posKeys: [[0, 0, 0, 0.5], [1, 0, 0, 0.7]],
	}],
	...over,
})

describe('AnimPlayer', () => {
	it('plays a signaled motion: samples keys, writes bone locals; stop returns to rest', () => {
		registerAnim('anim-a', makeDef())
		expect(hasAnim('anim-a')).toBe(true)
		const bones = bonesFor('mPelvis')
		const p = new AnimPlayer(bones)
		expect(p.setSignaled([{ id: 'anim-a', seq: 1 }], 100)).toEqual([])
		p.update(100.5)   // halfway: pos z 0.5→0.7 lerps to 0.6 REST-RELATIVE (pelvis) → 1.6, rot halfway to 90°Z = 45°
		const b = bones.get('mPelvis')
		expect(b.position.z).toBeCloseTo(1.6, 3)
		const e = new THREE.Euler().setFromQuaternion(b.quaternion, 'ZYX')
		expect(THREE.MathUtils.radToDeg(e.z)).toBeCloseTo(45, 0)
		// De-signal → (easeOut 0) rest restored on the next tick.
		p.setSignaled([], 100.6)
		p.update(100.7)
		expect(b.position.z).toBeCloseTo(1, 6)
		expect(b.quaternion.w).toBeCloseTo(1, 6)
		expect(p.activeCount).toBe(0)
	})

	it('unknown assets are reported missing and join via noteAnimLoaded while still signaled', () => {
		const p = new AnimPlayer(bonesFor('mPelvis'))
		expect(p.setSignaled([{ id: 'anim-miss', seq: 1 }], 0)).toEqual(['anim-miss'])
		registerAnim('anim-miss', makeDef())
		p.noteAnimLoaded('anim-miss', 1)
		expect(p.activeCount).toBe(1)
	})

	it('higher joint priority masks lower at full weight', () => {
		registerAnim('anim-low', makeDef({ basePriority: 0 }, [{
			name: 'mPelvis', priority: -1, rotKeys: [[0, ...rot90Z]], posKeys: [[0, 0, 0, 0.2]],
		}]))
		registerAnim('anim-high', makeDef({ basePriority: 4 }, [{
			name: 'mPelvis', priority: -1, rotKeys: [[0, 0, 0, 0, 1]], posKeys: [[0, 0, 0, 0.9]],
		}]))
		const bones = bonesFor('mPelvis')
		const p = new AnimPlayer(bones)
		p.setSignaled([{ id: 'anim-low', seq: 1 }, { id: 'anim-high', seq: 1 }], 50)
		p.update(50.4)
		const b = bones.get('mPelvis')
		expect(b.position.z).toBeCloseTo(1.9, 4)          // high fully masks low (rest 1 + key 0.9)
		expect(b.quaternion.w).toBeCloseTo(1, 4)          // identity rot from the high anim
	})

	it('non-pelvis pos keys REPLACE the local offset (FS setPosition semantics)', () => {
		registerAnim('anim-chest', makeDef({}, [{
			name: 'mChest', priority: -1, rotKeys: [], posKeys: [[0, 0.1, 0.2, 0.3]],
		}]))
		const bones = bonesFor('mChest')
		const p = new AnimPlayer(bones)
		p.setSignaled([{ id: 'anim-chest', seq: 1 }], 0)
		p.update(0.1)
		const b = bones.get('mChest')
		expect(b.position.x).toBeCloseTo(0.1, 5)   // absolute, NOT rest(0,0,1)+key
		expect(b.position.z).toBeCloseTo(0.3, 5)
	})

	it('ease-in ramps weight smoothly (cubic step)', () => {
		registerAnim('anim-ease', makeDef({ easeIn: 1 }, [{
			name: 'mPelvis', priority: -1, rotKeys: [], posKeys: [[0, 0, 0, 2]],
		}]))
		const bones = bonesFor('mPelvis')
		const p = new AnimPlayer(bones)
		p.setSignaled([{ id: 'anim-ease', seq: 1 }], 0)
		p.update(0.5)   // cubicStep(0.5)=0.5 → target rest(1)+key(2)=3 → lerp(1, 3, .5) = 2
		expect(bones.get('mPelvis').position.z).toBeCloseTo(2, 3)
	})

	it('same id with a new seq restarts from t=0', () => {
		registerAnim('anim-seq', makeDef({ loop: false }))
		const bones = bonesFor('mPelvis')
		const p = new AnimPlayer(bones)
		p.setSignaled([{ id: 'anim-seq', seq: 1 }], 0)
		p.update(0.9)
		const zBefore = bones.get('mPelvis').position.z   // near end of the (rest 1 +) 0.5→0.7 ramp
		p.setSignaled([{ id: 'anim-seq', seq: 2 }], 0.9)  // reseq'd → restart
		p.update(0.9)
		expect(bones.get('mPelvis').position.z).toBeCloseTo(1.5, 3)
		expect(zBefore).toBeGreaterThan(1.65)
	})

	it('looping cycles [loopIn, loopOut]', () => {
		registerAnim('anim-loop', makeDef({ loopIn: 0.2, loopOut: 0.8 }))
		const bones = bonesFor('mPelvis')
		const p = new AnimPlayer(bones)
		p.setSignaled([{ id: 'anim-loop', seq: 1 }], 0)
		p.update(1.4)   // age 1.4 → 0.2 + (1.2 % 0.6) = 0.8 → pos z = rest 1 + (0.5 + 0.8·0.2) = 1.66
		expect(bones.get('mPelvis').position.z).toBeCloseTo(1.66, 3)
	})
})
