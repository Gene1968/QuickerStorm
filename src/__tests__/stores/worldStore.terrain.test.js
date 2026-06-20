import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useWorldStore } from '@/stores/worldStore'

// Var-region collision heightmap (2026-06-20): a fixed 513² array left the avatar falling through past
// Y/X=512 on a 1024 region — sampleTerrainHeight read ≈0 past the array edge while the terrain rendered
// fine (collisionH=0 vs renderH=39, proven live). The heightmap must size to regionDim+1.
beforeEach(() => setActivePinia(createPinia()))

const heights16 = (v) => Array.from({ length: 256 }, () => v)   // flat 16×16 patch of height v

describe('terrain collision heightmap sizing', () => {
	it('resolveTerrainStride = regionDim+1, clamped to [256, MAX] band', () => {
		const s = useWorldStore()
		expect(s.resolveTerrainStride(256)).toBe(257)
		expect(s.resolveTerrainStride(512)).toBe(513)
		expect(s.resolveTerrainStride(1024)).toBe(1025)
		expect(s.resolveTerrainStride(4096)).toBe(2049)   // capped at MAX_TERRAIN_DIM=2048 → 2049
		expect(s.resolveTerrainStride(0)).toBe(257)        // garbage/zero → floor 256
	})

	it('ensureTerrainGrid resizes the heights array to (regionDim+1)²', () => {
		const s = useWorldStore()
		s.ensureTerrainGrid(1024)
		expect(s.TERRAIN_STRIDE).toBe(1025)
		expect(s.terrainHeights.length).toBe(1025 * 1025)
	})

	it('ensureTerrainGrid is a no-op (same array) when the dimension is unchanged', () => {
		const s = useWorldStore()
		s.ensureTerrainGrid(1024)
		const ref1 = s.terrainHeights
		s.ensureTerrainGrid(1024)
		expect(s.terrainHeights).toBe(ref1)   // not reallocated
	})

	it('stores a patch PAST 512 once the grid is region-sized (the fall-through fix)', () => {
		const s = useWorldStore()
		s.ensureTerrainGrid(1024)
		// patch (40,40) → slX/slY 640..655 — beyond the old 512 cap
		s.setTerrainPatch(40, 40, heights16(27), 16)
		expect(s.terrainHeights[640 * 1025 + 640]).toBe(27)
	})

	it('drops past-512 coords at the default 513 stride (old behavior before resize)', () => {
		const s = useWorldStore()
		expect(s.TERRAIN_STRIDE).toBe(513)
		s.setTerrainPatch(40, 40, heights16(27), 16)   // slX=640 ≥ 513 → dropped
		// index 640 doesn't exist in a 513² array; the SW quadrant is untouched at this coord
		expect(s.terrainHeights[640 * 513 + 640] ?? 0).toBe(0)
	})

	it('still stores coords within the region grid', () => {
		const s = useWorldStore()
		s.ensureTerrainGrid(1024)
		s.setTerrainPatch(2, 3, heights16(11), 16)   // slX 32..47, slY 48..63
		expect(s.terrainHeights[48 * 1025 + 32]).toBe(11)
	})
})
