import { describe, it, expect } from 'vitest'
import {
	computeAspect,
	buildAspectOptions,
	computePreviewSize,
	ASPECT_OPTIONS,
	CHROME_W,
	CHROME_H,
	MIN_W,
	MIN_H,
} from '@/lib/texturePreviewSizing.js'

describe('computeAspect', () => {
	it('reduces 1024x512 to the fixed 2:1 option', () => {
		expect(computeAspect(1024, 512)).toEqual({ label: '2:1', ratio: 2 })
	})
	it('reduces a square to 1:1', () => {
		expect(computeAspect(512, 512).label).toBe('1:1')
	})
	it('matches 4:3', () => {
		expect(computeAspect(1024, 768).label).toBe('4:3')
	})
	it('matches 16:9 within tolerance', () => {
		expect(computeAspect(1920, 1080).label).toBe('16:9')
	})
	it('produces a reduced custom w:h label when no fixed option matches', () => {
		// 1024x683 → gcd 1 → literal '683:1024'? No — label is w:h reduced, so 1024:683.
		expect(computeAspect(1024, 683).label).toBe('1024:683')
	})
	it('reduces a custom ratio to lowest terms', () => {
		// 300x200 → gcd 100 → 3:2 (a fixed option, so it matches that instead)
		expect(computeAspect(300, 200).label).toBe('3:2')
		// 500x300 → gcd 100 → 5:3 (custom)
		expect(computeAspect(500, 300).label).toBe('5:3')
	})
	it('returns Unconstrained for zero/invalid sizes', () => {
		expect(computeAspect(0, 0).label).toBe('Unconstrained')
		expect(computeAspect(100, 0).ratio).toBe(null)
	})
})

describe('buildAspectOptions', () => {
	it('does not append when the ratio matches a fixed option', () => {
		const { options, selectedLabel } = buildAspectOptions(1024, 512)
		expect(options).toBe(ASPECT_OPTIONS)
		expect(selectedLabel).toBe('2:1')
	})
	it('appends a custom option and selects it when unmatched', () => {
		const { options, selectedLabel } = buildAspectOptions(1024, 683)
		expect(options.length).toBe(ASPECT_OPTIONS.length + 1)
		expect(options.at(-1).label).toBe('1024:683')
		expect(selectedLabel).toBe('1024:683')
	})
})

describe('computePreviewSize', () => {
	it('fits native pixels plus chrome for a small texture', () => {
		const r = computePreviewSize(512, 512, 1920, 1080)
		expect(r.width).toBe(512 + CHROME_W)
		expect(r.height).toBe(512 + CHROME_H)
	})
	it('clamps to the minimum for a tiny texture', () => {
		const r = computePreviewSize(32, 32, 1920, 1080)
		expect(r.width).toBe(MIN_W)
		expect(r.height).toBe(MIN_H)
	})
	it('halves resolution when a dimension exceeds the viewport', () => {
		// 2048 wide on a 1000px viewport → half → 1024, then capped to viewport width.
		const r = computePreviewSize(2048, 1024, 1000, 2000)
		// half width 1024 + chrome exceeds viewport 1000 → capped at 1000
		expect(r.width).toBe(1000)
		// half height 512 + chrome fits under 2000
		expect(r.height).toBe(512 + CHROME_H)
	})
	it('does not apply the 512 legacy cap (large-but-fitting stays native)', () => {
		// 800x800 on a big viewport: no half-res, no 512 cap.
		const r = computePreviewSize(800, 800, 4000, 4000)
		expect(r.width).toBe(800 + CHROME_W)
		expect(r.height).toBe(800 + CHROME_H)
	})
	it('nudges an overflowing floater back on-screen', () => {
		const r = computePreviewSize(512, 512, 1920, 1080, { left: 1800, top: 900 })
		expect(r.left + r.width).toBeLessThanOrEqual(1920)
		expect(r.top + r.height).toBeLessThanOrEqual(1080)
		expect(r.left).toBeGreaterThanOrEqual(0)
		expect(r.top).toBeGreaterThanOrEqual(0)
	})
	it('returns null position when no current position is supplied', () => {
		const r = computePreviewSize(512, 512, 1920, 1080)
		expect(r.left).toBe(null)
		expect(r.top).toBe(null)
	})
})
