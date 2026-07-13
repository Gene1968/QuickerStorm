import { describe, it, expect } from 'vitest'
import {
	resolveAvatarReparent,
	gateBuyHoverAction,
	CTRL_STAND_UP,
	CTRL_SIT_ON_GROUND,
} from '@/lib/seatEngine.js'

describe('CTRL_STAND_UP / CTRL_SIT_ON_GROUND constants', () => {
	it('match FS indra_constants.h bit positions (1<<16, 1<<17)', () => {
		expect(CTRL_STAND_UP).toBe(1 << 16)
		expect(CTRL_SIT_ON_GROUND).toBe(1 << 17)
	})
})

// shouldStandFromMovement was removed 2026-07-13: FS ground truth (llagent.cpp:763-914) has NO
// auto-stand on movement keys while seated — flags are sent and the sim ignores them.

describe('resolveAvatarReparent', () => {
	it('no change (0 → 0) → changed:false', () => {
		expect(resolveAvatarReparent(0, 0)).toEqual({ changed: false })
	})
	it('no change (same nonzero parent) → changed:false', () => {
		expect(resolveAvatarReparent(42, 42)).toEqual({ changed: false })
	})
	it('sit down (0 → seat localId) → attach', () => {
		expect(resolveAvatarReparent(0, 77)).toEqual({ changed: true, action: 'attach', parentId: 77 })
	})
	it('stand up (seat localId → 0) → detach', () => {
		expect(resolveAvatarReparent(77, 0)).toEqual({ changed: true, action: 'detach', parentId: 0 })
	})
	it('reseat onto a different prim (seat A → seat B) → attach to B', () => {
		expect(resolveAvatarReparent(77, 99)).toEqual({ changed: true, action: 'attach', parentId: 99 })
	})
	it('undefined prevParentId treated as 0 (fresh mesh, unset userData.parentId)', () => {
		expect(resolveAvatarReparent(undefined, 0)).toEqual({ changed: false })
		expect(resolveAvatarReparent(undefined, 5)).toEqual({ changed: true, action: 'attach', parentId: 5 })
	})
})

describe('gateBuyHoverAction', () => {
	it('Buy on a for-sale root passes through unchanged', () => {
		expect(gateBuyHoverAction(2, { isChild: false, saleType: 1 })).toBe(2)
	})
	it('Buy on a root with saleType 0 (not for sale) is suppressed', () => {
		expect(gateBuyHoverAction(2, { isChild: false, saleType: 0 })).toBe(0)
	})
	it('Buy on a root with saleType UNKNOWN is suppressed (Gene 2026-07-13: pointer only when KNOWN for-sale; hover fires RequestObjectPropertiesFamily to learn it)', () => {
		expect(gateBuyHoverAction(2, { isChild: false })).toBe(0)
		expect(gateBuyHoverAction(2, { isChild: false, saleType: undefined })).toBe(0)
		expect(gateBuyHoverAction(2, { isChild: false, saleType: null })).toBe(0)
	})
	it('Pay on a root passes through regardless of saleType', () => {
		expect(gateBuyHoverAction(3, { isChild: false, saleType: 0 })).toBe(3)
		expect(gateBuyHoverAction(3, { isChild: false })).toBe(3)
	})
	it('Buy/Pay on a child prim is suppressed regardless of saleType', () => {
		expect(gateBuyHoverAction(2, { isChild: true, saleType: 1 })).toBe(0)
		expect(gateBuyHoverAction(3, { isChild: true, saleType: 1 })).toBe(0)
	})
	it('non-buy/pay click actions (e.g. Sit=1, Touch=0) pass through unchanged', () => {
		expect(gateBuyHoverAction(1, { isChild: false, saleType: 0 })).toBe(1)
		expect(gateBuyHoverAction(0, { isChild: true })).toBe(0)
	})
})
