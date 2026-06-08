import { describe, it, expect } from 'bun:test'
import {
	correctionBlend,
	GROUND_SNAP_DIST,
	AIR_SNAP_DIST,
	FLY_SNAP_DIST,
	SETTLE_BLEND,
} from '@/lib/movementCorrection.js'

describe('correctionBlend — grounded', () => {
	it('idle small gap → gentle settle', () => {
		expect(correctionBlend({ d: 2, isFlying: false, airborne: false, movingNow: false })).toBe(SETTLE_BLEND)
	})
	it('moving small gap → no correction (DR owns the stride)', () => {
		expect(correctionBlend({ d: 2, isFlying: false, airborne: false, movingNow: true })).toBe(0)
	})
	it('large gap → snap regardless of movement', () => {
		expect(correctionBlend({ d: GROUND_SNAP_DIST + 1, isFlying: false, airborne: false, movingNow: true })).toBe(1)
	})
})

describe('correctionBlend — airborne (jump arc)', () => {
	it('under threshold → fully suppressed', () => {
		expect(correctionBlend({ d: 10, isFlying: false, airborne: true, movingNow: false })).toBe(0)
	})
	it('teleport-scale → snap', () => {
		expect(correctionBlend({ d: AIR_SNAP_DIST + 1, isFlying: false, airborne: true, movingNow: false })).toBe(1)
	})
})

describe('correctionBlend — flying (regression: no mid-flight spring-back)', () => {
	it('the captured FLYSNAP case (d=8.8 while moving) no longer hard-snaps', () => {
		// Before the fix this returned 1.0 (grounded regime, d>5) and yanked the avatar
		// down to the lagging sim Z. Flying + moving must now trust DR → blend 0.
		expect(correctionBlend({ d: 8.8, isFlying: true, airborne: false, movingNow: true })).toBe(0)
	})
	it('large transient still under fly threshold → no snap while moving', () => {
		expect(correctionBlend({ d: 27, isFlying: true, airborne: false, movingNow: true })).toBe(0)
	})
	it('at rest in the air → gentle settle so the post-key coast reconciles', () => {
		expect(correctionBlend({ d: 6, isFlying: true, airborne: false, movingNow: false })).toBe(SETTLE_BLEND)
	})
	it('teleport-scale gap → snap even while flying', () => {
		expect(correctionBlend({ d: FLY_SNAP_DIST + 1, isFlying: true, airborne: false, movingNow: true })).toBe(1)
	})
	it('isFlying takes precedence over a stale airborne flag', () => {
		expect(correctionBlend({ d: 8.8, isFlying: true, airborne: true, movingNow: true })).toBe(0)
	})
})
