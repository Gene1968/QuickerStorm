// WHY: SL terrain = 4 detail textures blended by elevation. Regions that don't
// override a slot send the well-known DEFAULT terrain UUID; bundling those defaults
// locally lets us paint instantly (browser-native WebP, no grid fetch / no J2C decode)
// and gives a correct-looking fallback while a custom slot's texture decodes.
import dirtUrl     from '@/assets/img/terrain-dirt.webp'
import grassUrl    from '@/assets/img/terrain-grass.webp'
import rockUrl     from '@/assets/img/terrain-rock.webp'
import mountainUrl from '@/assets/img/terrain-mountain.webp'

// Confirmed vs OpenSim RegionSettings.cs DEFAULT_TERRAIN_TEXTURE_1..4.
export const DEFAULT_TERRAIN_UUIDS = {
	'b8d3965a-ad78-bf43-699b-bff8eca6c975': dirtUrl,
	'abb783e6-3e93-26c0-248a-247666855da3': grassUrl,
	'179cdabd-398a-9b6b-1391-4dc333ba321f': rockUrl,
	'beb169c7-11ea-fff2-efe5-0f24dc881df2': mountainUrl,
}

// Fallback bound to a slot whose texture is empty/not-yet-resolved so the shader is never under-bound.
export const FALLBACK_TERRAIN_URL = grassUrl

/**
 * Classify a terrain detail slot UUID.
 * @returns {{kind:'default', url:string} | {kind:'custom', uuid:string}}
 */
export function resolveTerrainSlot(uuid) {
	if (!uuid) return { kind: 'default', url: FALLBACK_TERRAIN_URL }
	const url = DEFAULT_TERRAIN_UUIDS[uuid]
	if (url) return { kind: 'default', url }
	return { kind: 'custom', uuid }
}

/**
 * Bilinear interpolation of a 4-corner value array ordered [00,01,10,11] = [x][y].
 * @param {number[]} c corners
 * @param {number} u 0..1 along X (west→east)
 * @param {number} v 0..1 along Y (south→north)
 */
export function bilerpCorners(c, u, v) {
	const x0 = c[0] * (1 - v) + c[1] * v   // x=0 edge (00→01)
	const x1 = c[2] * (1 - v) + c[3] * v   // x=1 edge (10→11)
	return x0 * (1 - u) + x1 * u
}

/**
 * SL-style 4-layer terrain blend weights from elevation.
 * e = (elev - start) / range, dithered by `noise`, clamped 0..1, spread across the
 * 4 detail layers as a triangular (adjacent-pair) blend. The GLSL fragment mirrors this.
 * @returns {number[]} length-4 weights summing to ~1
 */
export function layerWeights(elev, start, range, noise) {
	// WHY: range is always ≥ 0 from RegionHandshake (TerrainHeightRange); we only guard the
	// zero case to avoid div-by-zero. A negative range would invert the ramp — not a real data path.
	const r = range === 0 ? 1e-6 : range
	let e = (elev - start) / r + noise
	if (e < 0) e = 0
	if (e > 1) e = 1
	const p = e * 3                 // position across layers 0..3
	const lo = Math.min(Math.floor(p), 3)
	const hi = Math.min(lo + 1, 3)
	const f = p - lo
	const w = [0, 0, 0, 0]
	w[lo] += 1 - f
	w[hi] += f
	return w
}
