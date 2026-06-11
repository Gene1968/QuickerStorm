import { describe, it, expect } from 'bun:test'
import { sculptToSubmesh, sculptGridResolution } from '../lib/sculptDecode'

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

// FS parity: grid resolution is ASPECT-AWARE (sculpt_calc_mesh_resolution, llvolume.cpp:3170)
// within a vertex budget of min(detail², w×h/4); vertices per axis = sides+1 (genNGon emits the
// 0..1-inclusive point set); map sampled at floor(k/sides × dim) — even texels for pow-2 maps.
describe('sculptGridResolution', () => {
	it('64×64 map at detail 32 → 32×32 sides (the canonical square case)', () => {
		expect(sculptGridResolution(64, 64, 32)).toEqual({ sidesS: 32, sidesT: 32 })
	})
	it('8×512 oblong map → 256 path sides × 4 profile sides (billboard-forest palms)', () => {
		expect(sculptGridResolution(8, 512, 32)).toEqual({ sidesS: 256, sidesT: 4 })
	})
	it('small 32×32 map → budget w×h/4 = 256 verts → 16×16 sides', () => {
		expect(sculptGridResolution(32, 32, 32)).toEqual({ sidesS: 16, sidesT: 16 })
	})
})

describe('sculptToSubmesh', () => {
	it('plane 64×64: (sides+1)² vertices, sides² quads, valid indices', () => {
		const map = makeMap(64, 64, (x, y) => [x * 4, y * 4, 128])
		const m = sculptToSubmesh(map, 64, 64, 3, 3 /* plane */, 32)
		expect(m.positions.length).toBe(33 * 33 * 3)
		expect(allFinite(m.positions)).toBe(true)
		expect(allFinite(m.normals)).toBe(true)
		expect(m.indices.length).toBe(32 * 32 * 6)
		expect(maxIndex(m.indices)).toBeLessThan(m.positions.length / 3)   // no out-of-range index
	})

	it('oblong 8×512 plane: 5×257 grid, UV spacing 1/4 × 1/256, FS sampling lattice only', () => {
		// FS samples columns floor(k/4×8)=2k (even from the left) and rows even from the BOTTOM
		// (LLImageRaw scanlines are bottom-up). Off-lattice texels hold garbage (+0.5) — it must
		// not leak (plane edge clamps land off-lattice by design, exempt).
		const map = makeMap(8, 512, (x, y) => (x % 2 === 1 || (511 - y) % 2 === 1 ? [255, 255, 255] : [128, 128, 128]))
		const m = sculptToSubmesh(map, 8, 512, 3, 3 /* plane */, 32)
		expect(m.positions.length).toBe(257 * 5 * 3)
		expect(m.indices.length).toBe(256 * 4 * 6)
		for (let j = 0; j < 256; j++) for (let k = 0; k < 4; k++) {   // interior verts
			const vi = (j * 5 + k) * 3
			expect(Math.abs(m.positions[vi])).toBeLessThan(0.01)
		}
		// UV spacing: u = k/4, v = j/256 → RepeatU=4/RepeatV=-256 = exactly one texture per quad
		expect(m.uvs[(0 * 5 + 1) * 2]).toBeCloseTo(1 / 4, 6)
		expect(m.uvs[(1 * 5 + 0) * 2 + 1]).toBeCloseTo(1 / 256, 6)
	})

	it('samples the FS lattice of a 64×64 map: even columns, rows even from the BOTTOM', () => {
		const map = makeMap(64, 64, (x, y) => (x % 2 === 1 || (63 - y) % 2 === 1 ? [255, 255, 255] : [128, 128, 128]))
		const m = sculptToSubmesh(map, 64, 64, 3, 3 /* plane */, 32)
		for (let j = 0; j < 32; j++) for (let k = 0; k < 32; k++) {
			const vi = (j * 33 + k) * 3
			expect(Math.abs(m.positions[vi])).toBeLessThan(0.01)
			expect(Math.abs(m.positions[vi + 1])).toBeLessThan(0.01)
			expect(Math.abs(m.positions[vi + 2])).toBeLessThan(0.01)
		}
	})

	it('grid row 0 (UV v=0) samples the BOTTOM data row — LLImageRaw bottom-up parity', () => {
		// Bottom data row (y=63) encodes +x (255); top row (y=0) encodes -x (0).
		const map = makeMap(64, 64, (x, y) => [y === 63 ? 255 : y === 0 ? 0 : 128, 128, 128])
		const m = sculptToSubmesh(map, 64, 64, 3, 3 /* plane */, 32)
		expect(m.positions[0]).toBeCloseTo(0.5, 2)                       // row j=0 ← bottom row
		const last = (32 * 33) * 3
		expect(m.positions[last]).toBeCloseTo(-0.5, 2)                   // row j=32 ← top row (clamped)
	})

	it('UV spacing is exactly k/sides (phase-aligns grid-multiple repeats)', () => {
		const map = makeMap(64, 64, () => [128, 128, 128])
		const m = sculptToSubmesh(map, 64, 64, 3, 3, 32)
		const vi = (1 * 33 + 1) * 2
		expect(m.uvs[vi]).toBeCloseTo(1 / 32, 6)
		expect(m.uvs[vi + 1]).toBeCloseTo(1 / 32, 6)
		expect(m.uvs[(33 * 33 - 1) * 2]).toBe(1)       // last vertex u = 1
		expect(m.uvs[(33 * 33 - 1) * 2 + 1]).toBe(1)   // last vertex v = 1
	})

	it('cylinder/torus wrap the side seam: last column equals column 0', () => {
		const map = makeMap(64, 64, (x, y) => [x * 4, y * 4, 200])
		for (const t of [4 /* cyl */, 2 /* torus */]) {
			const m = sculptToSubmesh(map, 64, 64, 3, t, 32)
			expect(m.positions.length).toBe(33 * 33 * 3)
			for (let j = 0; j < 33; j++) {
				const a = (j * 33) * 3, b = (j * 33 + 32) * 3
				expect(m.positions[b]).toBe(m.positions[a])
				expect(m.positions[b + 1]).toBe(m.positions[a + 1])
				expect(m.positions[b + 2]).toBe(m.positions[a + 2])
			}
		}
	})

	it('torus wraps vertically too: last row equals row 0', () => {
		const map = makeMap(64, 64, (x, y) => [x * 4, y * 4, 200])
		const m = sculptToSubmesh(map, 64, 64, 3, 2 /* torus */, 32)
		for (let k = 0; k < 33; k++) {
			const a = k * 3, b = (32 * 33 + k) * 3
			expect(m.positions[b]).toBe(m.positions[a])
			expect(m.positions[b + 1]).toBe(m.positions[a + 1])
			expect(m.positions[b + 2]).toBe(m.positions[a + 2])
		}
	})

	it('sphere: top and bottom rows collapse to a single pole point each', () => {
		const map = makeMap(64, 64, (x, y) => [x * 4, y * 4, x + y])
		const m = sculptToSubmesh(map, 64, 64, 3, 1 /* sphere */, 32)
		const across = 33
		const v0 = [m.positions[0], m.positions[1], m.positions[2]]
		for (let x = 1; x < across; x++) {
			const i = x * 3
			expect([m.positions[i], m.positions[i + 1], m.positions[i + 2]]).toEqual(v0)
		}
	})

	it('mirror flag (0x80) negates X', () => {
		const map = makeMap(8, 8, () => [255, 128, 128])   // x = +0.5 everywhere
		const plain = sculptToSubmesh(map, 8, 8, 3, 3, 8)
		const mirrored = sculptToSubmesh(map, 8, 8, 3, 3 | 0x80, 8)
		expect(plain.positions[0]).toBeCloseTo(0.5, 3)
		expect(mirrored.positions[0]).toBeCloseTo(-0.5, 3)
	})

	it('maps pixel RGB to local-space [-0.5,0.5] (mid-grey → ~0)', () => {
		const map = makeMap(8, 8, () => [128, 128, 128])
		const m = sculptToSubmesh(map, 8, 8, 3, 3, 8)
		expect(m.positions.every(v => Math.abs(v) < 0.01)).toBe(true)
	})

	it('handles 1-channel (greyscale) maps without crashing', () => {
		const px = new Uint8Array(16 * 16).fill(64)
		const m = sculptToSubmesh(px, 16, 16, 1, 3, 16)
		expect(allFinite(m.positions)).toBe(true)
		expect(m.indices.length).toBeGreaterThan(0)
	})
})
