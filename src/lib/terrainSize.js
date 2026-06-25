// src/lib/terrainSize.js — derive a region's dimension (metres) from the terrain LayerData patches
// it streams. WHY: var-region size is supposed to arrive via the login response / EQ TeleportFinish
// RegionSizeX / a map block — but some grids omit ALL of those on a cross-region teleport, leaving the
// client stuck at the 256m default (teleport clamps to 255,255; terrain + collision grid sized to 256m
// on a 1024m region). Terrain patches are universal: EVERY region streams them, and the highest patch
// index unambiguously gives the size — patch index 63 (at 16m/patch) means a 1024m region
// ((63+1)×16). This is the grid-agnostic source of truth, independent of any optional size field.

const PATCH_SIZE = 16

/**
 * Largest region dimension implied by a batch of terrain patches.
 * @param {Array<{x:number,y:number}>} patches  decoded LAND patches (px,py = patch grid indices)
 * @param {number} patchSize  metres per patch axis (16 in SL/OpenSim)
 * @returns {number} region dimension in metres, or 0 if no usable patches (caller treats 0 as no-op)
 */
export function terrainRegionDim(patches, patchSize = PATCH_SIZE) {
	if (!Array.isArray(patches) || patches.length === 0) return 0
	let maxIdx = -1
	for (const p of patches) {
		if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') continue
		const idx = Math.max(p.x, p.y)
		if (idx > maxIdx) maxIdx = idx
	}
	if (maxIdx < 0) return 0
	return (maxIdx + 1) * patchSize
}
