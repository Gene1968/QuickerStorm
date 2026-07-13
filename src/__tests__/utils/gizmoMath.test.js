// src/__tests__/utils/gizmoMath.test.js — hand-computed goldens for the gizmo drag math ported
// from Firestorm's LLManip family. See src/utils/gizmoMath.js for the per-function FS citations.
import { describe, it, expect } from 'vitest'
import {
	mouseRayPlaneIntersect,
	projectDeltaOntoAxis,
	ringAngle,
	nearestPointOnLineParam,
	lightenColor,
} from '@/utils/gizmoMath.js'

describe('mouseRayPlaneIntersect', () => {
	it('hits a plane straight ahead of the ray origin', () => {
		// Ray from (0,0,5) looking down -z; plane at z=0 facing the ray (normal +z).
		const hit = mouseRayPlaneIntersect(
			{ x: 0, y: 0, z: 5 }, { x: 0, y: 0, z: -1 },
			{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 },
		)
		expect(hit.x).toBeCloseTo(0, 6)
		expect(hit.y).toBeCloseTo(0, 6)
		expect(hit.z).toBeCloseTo(0, 6)
	})

	it('resolves an off-axis / angled ray correctly', () => {
		// Ray from (2,3,5) aimed at (0,3,0) — passes through the z=0 plane at (0,3,0).
		const origin = { x: 2, y: 3, z: 5 }
		const target = { x: 0, y: 3, z: 0 }
		const dir = { x: target.x - origin.x, y: target.y - origin.y, z: target.z - origin.z }
		const hit = mouseRayPlaneIntersect(origin, dir, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 })
		expect(hit.x).toBeCloseTo(0, 5)
		expect(hit.y).toBeCloseTo(3, 5)
		expect(hit.z).toBeCloseTo(0, 5)
	})

	it('returns null for a ray parallel to the plane', () => {
		const hit = mouseRayPlaneIntersect(
			{ x: 0, y: 0, z: 5 }, { x: 1, y: 0, z: 0 },
			{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 },
		)
		expect(hit).toBeNull()
	})

	it('returns null when the plane is behind the ray origin', () => {
		const hit = mouseRayPlaneIntersect(
			{ x: 0, y: 0, z: -5 }, { x: 0, y: 0, z: -1 },
			{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 },
		)
		expect(hit).toBeNull()
	})
})

describe('projectDeltaOntoAxis', () => {
	it('dots a delta straight onto a unit axis', () => {
		expect(projectDeltaOntoAxis({ x: 3, y: 4, z: 0 }, { x: 1, y: 0, z: 0 })).toBeCloseTo(3, 6)
	})

	it('handles an off-axis delta (45° case)', () => {
		// delta (1,1,0) projected onto x-axis → 1 (only the x component contributes).
		expect(projectDeltaOntoAxis({ x: 1, y: 1, z: 0 }, { x: 1, y: 0, z: 0 })).toBeCloseTo(1, 6)
	})

	it('normalizes a non-unit axis before dotting', () => {
		// axis (0,2,0) should behave identically to unit (0,1,0).
		expect(projectDeltaOntoAxis({ x: 0, y: 5, z: 0 }, { x: 0, y: 2, z: 0 })).toBeCloseTo(5, 6)
	})

	it('is negative when the delta opposes the axis', () => {
		expect(projectDeltaOntoAxis({ x: -2, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })).toBeCloseTo(-2, 6)
	})
})

describe('ringAngle', () => {
	it('computes a 45° signed angle around the z-axis', () => {
		const center = { x: 0, y: 0, z: 0 }
		const axis = { x: 0, y: 0, z: 1 }
		const start = { x: 1, y: 0, z: 0 }
		const cur = { x: Math.SQRT1_2, y: Math.SQRT1_2, z: 0 }
		expect(ringAngle(center, axis, start, cur)).toBeCloseTo(Math.PI / 4, 6)
	})

	it('is negative for the opposite winding direction', () => {
		const center = { x: 0, y: 0, z: 0 }
		const axis = { x: 0, y: 0, z: 1 }
		const start = { x: 1, y: 0, z: 0 }
		const cur = { x: Math.SQRT1_2, y: -Math.SQRT1_2, z: 0 }
		expect(ringAngle(center, axis, start, cur)).toBeCloseTo(-Math.PI / 4, 6)
	})

	it('returns ±π/2 for a quarter turn', () => {
		const center = { x: 0, y: 0, z: 0 }
		const axis = { x: 0, y: 0, z: 1 }
		const start = { x: 1, y: 0, z: 0 }
		const cur = { x: 0, y: 1, z: 0 }
		expect(ringAngle(center, axis, start, cur)).toBeCloseTo(Math.PI / 2, 6)
	})

	it('is offset-invariant (uses center, not the origin)', () => {
		const center = { x: 5, y: -2, z: 3 }
		const axis = { x: 0, y: 0, z: 1 }
		const start = { x: 6, y: -2, z: 3 }
		const cur = { x: 5 + Math.SQRT1_2, y: -2 + Math.SQRT1_2, z: 3 }
		expect(ringAngle(center, axis, start, cur)).toBeCloseTo(Math.PI / 4, 6)
	})

	it('works for a non-cardinal (tilted) axis', () => {
		// axis = normalized (1,1,1); start/cur chosen perpendicular to axis, 90° apart.
		const axis = { x: 1, y: 1, z: 1 }
		const center = { x: 0, y: 0, z: 0 }
		// two vectors perpendicular to (1,1,1): (1,-1,0) and (1,1,-2) (both dot axis = 0)
		const start = { x: 1, y: -1, z: 0 }
		const cur = { x: 1, y: 1, z: -2 }
		const angle = ringAngle(center, axis, start, cur)
		expect(angle).toBeCloseTo(Math.PI / 2, 5)
	})
})

describe('nearestPointOnLineParam', () => {
	it('finds where a perpendicular ray crosses the axis line', () => {
		// Line = x-axis; ray from (2,0,5) straight down -z crosses the x-axis at x=2 → t=2.
		const t = nearestPointOnLineParam(
			{ x: 2, y: 0, z: 5 }, { x: 0, y: 0, z: -1 },
			{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 },
		)
		expect(t).toBeCloseTo(2, 6)
	})

	it('handles an angled ray against the line', () => {
		// Line = x-axis. Ray from (0,5,5) aimed at (4,0,0) — passes through the x-axis at x=4.
		const origin = { x: 0, y: 5, z: 5 }
		const target = { x: 4, y: 0, z: 0 }
		const dir = { x: target.x - origin.x, y: target.y - origin.y, z: target.z - origin.z }
		const t = nearestPointOnLineParam(origin, dir, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })
		expect(t).toBeCloseTo(4, 5)
	})

	it('returns 0 for a ray parallel to the line', () => {
		const t = nearestPointOnLineParam(
			{ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 },
			{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 },
		)
		expect(t).toBe(0)
	})

	it('negative t when the crossing is behind lineA', () => {
		const t = nearestPointOnLineParam(
			{ x: -3, y: 0, z: 5 }, { x: 0, y: 0, z: -1 },
			{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 },
		)
		expect(t).toBeCloseTo(-3, 6)
	})
})

describe('lightenColor', () => {
	it('leaves the color unchanged at amount=0', () => {
		expect(lightenColor(0xff5555, 0)).toBe(0xff5555)
	})

	it('goes fully white at amount=1', () => {
		expect(lightenColor(0xff5555, 1)).toBe(0xffffff)
	})

	it('blends halfway toward white', () => {
		// R/B already at 255 (unaffected); G 0x55=85 → 85 + (255-85)*0.5 = 170 = 0xaa
		expect(lightenColor(0xff55ff, 0.5)).toBe(0xffaaff)
	})

	it('clamps amount outside 0..1', () => {
		expect(lightenColor(0x102030, 2)).toBe(0xffffff)
		expect(lightenColor(0x102030, -1)).toBe(0x102030)
	})
})
