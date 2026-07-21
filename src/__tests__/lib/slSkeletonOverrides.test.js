// 7·D: mesh joint-position overrides + pelvis fixup — pins the FS-ported translation extraction,
// aboveJointPosThreshold gate, first-mesh-wins arbitration, AnimPlayer re-anchor, and pelvis lift.
import { describe, it, expect } from 'bun:test'
import { createSLSkeleton, applyMeshJointOverrides } from '@/lib/slSkeleton.js'

const FOOT = 0.9

// Row-major 4×4 with translation in the last row (FS LLMatrix4 layout: getTranslation = floats 12/13/14).
const altMat = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]

const skinFor = (jointNames, positions, pelvisOffset = 0) => ({
	jointNames,
	bindShapeMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
	inverseBindMatrix: jointNames.map(() => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
	altInverseBindMatrix: positions.map(p => altMat(...p)),
	pelvisOffset,
})

describe('applyMeshJointOverrides', () => {
	it('overrides a joint LOCAL position from the alt matrix translation (bone.position + restPos)', () => {
		const skel = createSLSkeleton(FOOT)
		// mHead default local = (0,0,0.076). Move it to (0,0,0.15) — well above the 0.1mm threshold.
		const r = applyMeshJointOverrides(skel, skinFor(['mHead'], [[0, 0, 0.15]]), 'meshA')
		expect(r.applied).toBe(1)
		const head = skel.bones.get('mHead')
		expect(head.position.z).toBeCloseTo(0.15, 6)
		expect(head.userData.restPos.z).toBeCloseTo(0.15, 6)   // AnimPlayer re-anchors here
		expect(head.userData.defaultPos.z).toBeCloseTo(0.076, 6) // immutable default is untouched
	})

	it('ignores an override under the 0.1mm FS threshold (keeps the default joint)', () => {
		const skel = createSLSkeleton(FOOT)
		const d = skel.bones.get('mHead').userData.defaultPos
		const r = applyMeshJointOverrides(skel, skinFor(['mHead'], [[d.x, d.y, d.z + 0.00005]]), 'meshA')
		expect(r.applied).toBe(0)
		expect(r.below).toBe(1)
		expect(skel.bones.get('mHead').position.z).toBeCloseTo(0.076, 6)
		expect(skel.overrideBy.has('mHead')).toBe(false)
	})

	it('first mesh to claim a joint wins (a later mesh cannot fight it)', () => {
		const skel = createSLSkeleton(FOOT)
		applyMeshJointOverrides(skel, skinFor(['mHead'], [[0, 0, 0.15]]), 'body')
		const r = applyMeshJointOverrides(skel, skinFor(['mHead'], [[0, 0, 0.30]]), 'hat')
		expect(r.applied).toBe(0)
		expect(r.claimed).toBe(1)
		expect(skel.bones.get('mHead').position.z).toBeCloseTo(0.15, 6)   // body's value stands
		expect(skel.overrideBy.get('mHead')).toBe('body')
	})

	it('re-applying the same mesh is idempotent (same owner, same value)', () => {
		const skel = createSLSkeleton(FOOT)
		applyMeshJointOverrides(skel, skinFor(['mHead'], [[0, 0, 0.15]]), 'body')
		const r = applyMeshJointOverrides(skel, skinFor(['mHead'], [[0, 0, 0.15]]), 'body')
		expect(r.applied).toBe(1)
		expect(skel.bones.get('mHead').position.z).toBeCloseTo(0.15, 6)
	})

	it('pelvis_offset lifts the whole skeleton via the root (first-wins), not the pelvis bone', () => {
		const skel = createSLSkeleton(FOOT)
		expect(skel.root.position.y).toBeCloseTo(-FOOT, 6)
		applyMeshJointOverrides(skel, skinFor(['mPelvis'], [[0, 0, 1.067]], 0.08), 'body')  // pelvis at default → no joint ovr
		expect(skel.root.position.y).toBeCloseTo(-FOOT + 0.08, 6)   // SL +Z lift → Three +Y
		expect(skel.pelvisFixupBy).toBe('body')
		// a second mesh's fixup does not stack
		applyMeshJointOverrides(skel, skinFor([], [], 0.20), 'shoes')
		expect(skel.root.position.y).toBeCloseTo(-FOOT + 0.08, 6)
	})

	it('no-ops safely (but still applies pelvis fixup) when alt matrices are absent/mismatched', () => {
		const skel = createSLSkeleton(FOOT)
		const skin = { jointNames: ['mHead', 'mNeck'], altInverseBindMatrix: [altMat(0, 0, 0.15)], pelvisOffset: 0.05 }
		const r = applyMeshJointOverrides(skel, skin, 'body')   // 1 alt vs 2 joints → mismatch, skip overrides
		expect(r.applied).toBe(0)
		expect(r.has).toBe(false)
		expect(skel.bones.get('mHead').position.z).toBeCloseTo(0.076, 6)
		expect(skel.root.position.y).toBeCloseTo(-FOOT + 0.05, 6) // fixup still honoured
	})

	it('rejects an implausible (garbage) joint deviation instead of flinging the joint', () => {
		const skel = createSLSkeleton(FOOT)
		// Live case: a hand mesh whose mPelvis alt "position" was 9.6 m off — must NOT be applied.
		const r = applyMeshJointOverrides(skel, skinFor(['mPelvis'], [[0, 0, 10.6]]), 'glove')
		expect(r.applied).toBe(0)
		expect(r.rejected).toBe(1)
		expect(skel.bones.get('mPelvis').position.z).toBeCloseTo(1.067, 6)   // default stands
		expect(skel.overrideBy.has('mPelvis')).toBe(false)
	})

	it('rejects a non-finite alt translation', () => {
		const skel = createSLSkeleton(FOOT)
		const r = applyMeshJointOverrides(skel, skinFor(['mHead'], [[0, 0, NaN]]), 'body')
		expect(r.applied).toBe(0)
		expect(r.rejected).toBe(1)
		expect(skel.bones.get('mHead').position.z).toBeCloseTo(0.076, 6)
	})
})
