import { describe, it, expect } from 'bun:test'
import { sculptToSubmesh } from '../lib/sculptDecode'

// Build a synthetic w×h RGB sculpt map from a per-pixel [r,g,b] function.
function makeMap(w: number, h: number, fn: (x: number, y: number) => [number, number, number]): Uint8Array {
	const px = new Uint8Array(w * h * 3)
	for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
		const [r, g, b] = fn(x, y); const i = (y * w + x) * 3
		px[i] = r; px[i + 1] = g; px[i + 2] = b
	}
	return px
}

const allFinite = (a: Float32Array) => a.every(Number.isFinite)
const maxIndex = (a: Uint16Array) => a.reduce((m, v) => Math.max(m, v), 0)

describe('sculptToSubmesh', () => {
	it('plane: open grid, no wrap column → detail² vertices, valid indices', () => {
		const map = makeMap(64, 64, (x, y) => [x * 4, y * 4, 128])
		const m = sculptToSubmesh(map, 64, 64, 3, 3 /* plane */, 32)
		expect(m.positions.length).toBe(32 * 32 * 3)   // no wrap col/row for plane
		expect(allFinite(m.positions)).toBe(true)
		expect(allFinite(m.normals)).toBe(true)
		expect(m.indices.length).toBe((32 - 1) * (32 - 1) * 6)
		expect(maxIndex(m.indices)).toBeLessThan(m.positions.length / 3)   // no out-of-range index
	})

	it('cylinder/sphere/torus add a wrap column (across = detail+1)', () => {
		const map = makeMap(32, 32, (x, y) => [x * 8, y * 8, 200])
		const cyl = sculptToSubmesh(map, 32, 32, 3, 4 /* cylinder */, 32)
		expect(cyl.positions.length).toBe(32 * 33 * 3)   // 32 rows × (32+1) cols
		const tor = sculptToSubmesh(map, 32, 32, 3, 2 /* torus */, 32)
		expect(tor.positions.length).toBe(33 * 33 * 3)   // wrap col AND wrap row
	})

	it('sphere: top and bottom rows collapse to a single pole point each', () => {
		const map = makeMap(32, 32, (x, y) => [x * 8, y * 8, x + y])
		const m = sculptToSubmesh(map, 32, 32, 3, 1 /* sphere */, 32)
		const across = 33   // 32 + wrap col
		// every vertex in row 0 is identical (the top pole)
		const v0 = [m.positions[0], m.positions[1], m.positions[2]]
		for (let x = 1; x < across; x++) {
			const i = x * 3
			expect([m.positions[i], m.positions[i + 1], m.positions[i + 2]]).toEqual(v0)
		}
	})

	it('maps pixel RGB to local-space [-0.5,0.5] (mid-grey → ~0)', () => {
		const map = makeMap(8, 8, () => [128, 128, 128])
		const m = sculptToSubmesh(map, 8, 8, 3, 3, 8)
		// 128/255 - 0.5 ≈ 0.00196 — all verts near origin
		expect(m.positions.every(v => Math.abs(v) < 0.01)).toBe(true)
	})

	it('handles 1-channel (greyscale) maps without crashing', () => {
		const px = new Uint8Array(16 * 16).fill(64)
		const m = sculptToSubmesh(px, 16, 16, 1, 3, 16)
		expect(allFinite(m.positions)).toBe(true)
		expect(m.indices.length).toBeGreaterThan(0)
	})
})
