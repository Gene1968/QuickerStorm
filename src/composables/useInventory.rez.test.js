import { describe, it, expect } from 'vitest'
import { rezPositionInFront, ASSET_TYPE_OBJECT } from '@/composables/useInventory'

// Pure position math for the "Rez in world" default drop point (~2m in front of the avatar).
// Forward basis matches useWorldEngine.js camAt: [-sin(yaw), cos(yaw), 0] in SL space.
describe('rezPositionInFront', () => {
	const AV = { x: 128, y: 128, z: 25 }

	it('yaw 0 (facing North / SL +Y) rezzes 2m north at avatar height', () => {
		const p = rezPositionInFront(AV, 0, 2)
		expect(p.x).toBeCloseTo(128, 5)     // -sin(0)=0 → no X shift
		expect(p.y).toBeCloseTo(130, 5)     //  cos(0)=1 → +2 north
		expect(p.z).toBe(25)                // avatar height unchanged
	})

	it('yaw +90° (facing West / SL -X) rezzes 2m west', () => {
		const p = rezPositionInFront(AV, Math.PI / 2, 2)
		expect(p.x).toBeCloseTo(126, 5)     // -sin(90°)=-1 → -2 X
		expect(p.y).toBeCloseTo(128, 5)     //  cos(90°)=0 → no Y shift
	})

	it('default distance is 2m', () => {
		const p = rezPositionInFront(AV, 0)
		expect(p.y).toBeCloseTo(130, 5)
	})

	it('custom distance scales the offset', () => {
		const p = rezPositionInFront(AV, 0, 5)
		expect(p.y).toBeCloseTo(133, 5)
	})

	it('clamps negative coords to 0 (never rez outside region min edge)', () => {
		const p = rezPositionInFront({ x: 1, y: 1, z: 0 }, Math.PI / 2, 2)   // -2 in X → -1
		expect(p.x).toBe(0)
		expect(p.z).toBe(0)
	})

	it('falls back to region centre when avatarPos is missing', () => {
		const p = rezPositionInFront(null, 0, 0)
		expect(p).toEqual({ x: 128, y: 128, z: 25 })
	})

	it('exports OBJECT asset type = 6 (SL rezzable object)', () => {
		expect(ASSET_TYPE_OBJECT).toBe(6)
	})
})
