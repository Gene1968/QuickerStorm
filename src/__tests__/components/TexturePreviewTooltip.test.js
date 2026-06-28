// src/__tests__/components/TexturePreviewTooltip.test.js
// Tests for the texture hover-preview tooltip: the pure on-screen clamping math and
// the component's image / placeholder rendering. No real fetch is exercised.

import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TexturePreviewTooltip, {
	clampPreviewPosition,
	PREVIEW_SIZE,
} from '@/components/TexturePreviewTooltip.vue'

const VW = 1000
const VH = 800

describe('clampPreviewPosition', () => {
	it('places the preview down-right of the cursor when there is room', () => {
		const { x, y } = clampPreviewPosition(100, 100, VW, VH)
		// offset is positive (down-right), and it fits on screen
		expect(x).toBeGreaterThan(100)
		expect(y).toBeGreaterThan(100)
		expect(x + PREVIEW_SIZE).toBeLessThanOrEqual(VW)
		expect(y + PREVIEW_SIZE).toBeLessThanOrEqual(VH)
	})

	it('flips to the left when the preview would overflow the right edge', () => {
		const { x } = clampPreviewPosition(VW - 10, 100, VW, VH)
		// placed to the LEFT of the cursor, fully on-screen
		expect(x).toBeLessThan(VW - 10)
		expect(x + PREVIEW_SIZE).toBeLessThanOrEqual(VW)
		expect(x).toBeGreaterThanOrEqual(0)
	})

	it('flips upward when the preview would overflow the bottom edge', () => {
		const { y } = clampPreviewPosition(100, VH - 10, VW, VH)
		expect(y).toBeLessThan(VH - 10)
		expect(y + PREVIEW_SIZE).toBeLessThanOrEqual(VH)
		expect(y).toBeGreaterThanOrEqual(0)
	})

	it('never returns negative coords even in a tiny viewport', () => {
		// Viewport smaller than the preview itself — clamp keeps the top-left on-screen.
		const { x, y } = clampPreviewPosition(5, 5, 200, 150)
		expect(x).toBeGreaterThanOrEqual(0)
		expect(y).toBeGreaterThanOrEqual(0)
	})

	it('keeps the square fully on-screen for a corner cursor', () => {
		const { x, y } = clampPreviewPosition(VW, VH, VW, VH)
		expect(x).toBeGreaterThanOrEqual(0)
		expect(y).toBeGreaterThanOrEqual(0)
		expect(x + PREVIEW_SIZE).toBeLessThanOrEqual(VW)
		expect(y + PREVIEW_SIZE).toBeLessThanOrEqual(VH)
	})
})

describe('TexturePreviewTooltip rendering', () => {
	it('renders the image once a src is provided', () => {
		const w = mount(TexturePreviewTooltip, {
			props: { src: 'blob:http://localhost/abc', x: 50, y: 60 },
		})
		const img = w.find('img')
		expect(img.exists()).toBe(true)
		expect(img.attributes('src')).toBe('blob:http://localhost/abc')
		expect(w.find('div.fixed').attributes('style')).toContain('left: 50px')
		expect(w.find('div.fixed').attributes('style')).toContain('top: 60px')
	})

	it('shows a loading placeholder (no img) while src is null', () => {
		const w = mount(TexturePreviewTooltip, { props: { src: null, x: 0, y: 0 } })
		expect(w.find('img').exists()).toBe(false)
		expect(w.text()).toContain('Loading preview')
	})
})
