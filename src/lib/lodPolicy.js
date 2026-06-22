// src/lib/lodPolicy.js — pure LOD selection for mesh assets (Firestorm-faithful, FEATURE-GAPS LOD).
// SL meshes ship 4 LOD blocks (high/medium/low/lowest); the viewer picks one by the object's
// apparent on-screen size — proportional to radius/distance, scaled by RenderVolumeLODFactor
// (Firestorm default 1.125). This returns the level index 0=high…3=lowest. Pure + total (no THREE).
//
// Thresholds are an INITIAL approximation of LLVOVolume::calcLOD — tune live + cross-check the local
// Firestorm source (indra/newview/llvovolume.cpp calcLOD + LLVolumeLODGroup). They are intentionally
// the only magic numbers here so tuning is one edit.
export const LOD_HIGH = 0, LOD_MEDIUM = 1, LOD_LOW = 2, LOD_LOWEST = 3

// Switch points on s = (radius/dist)*lodFactor. Cross below → coarser level. Calibrated GENEROUS
// (favour HIGH) so nearby objects stay lod 0 and hit the warm high-LOD cache instantly — a too-
// aggressive ramp makes near objects request lod 2/3, which miss the (bare-uuid) warm cache and
// re-download as placeholder cubes. radius-1 obj: HIGH≲94m, MEDIUM≲225m, LOW≲562m. Tune live.
const T_HIGH = 0.012, T_MEDIUM = 0.005, T_LOW = 0.002
const BOUNDARIES = [T_HIGH, T_MEDIUM, T_LOW]   // BOUNDARIES[k] separates level k from k+1
const HYST = 0.85   // must cross a boundary to ~15% beyond it to leave the current level

function rawLod(s) {
	return s >= T_HIGH ? LOD_HIGH : s >= T_MEDIUM ? LOD_MEDIUM : s >= T_LOW ? LOD_LOW : LOD_LOWEST
}

/**
 * @param {number} radius  object bounding-sphere radius (metres)
 * @param {number} dist    camera/avatar distance to the object (metres)
 * @param {number} lodFactor  RenderVolumeLODFactor (default 1.125)
 * @param {number} currentLod  the level currently built (-1 = none → no hysteresis)
 * @returns {0|1|2|3} 0=high … 3=lowest
 */
export function selectLod(radius, dist, lodFactor = 1.125, currentLod = -1) {
	if (!(radius > 0) || !(dist > 0)) return LOD_HIGH
	const s = (radius / dist) * lodFactor
	const raw = rawLod(s)
	if (currentLod < 0 || raw === currentLod) return raw
	// Hysteresis against the ONE boundary between currentLod and the adjacent level we'd move to.
	if (raw < currentLod) {
		// Moving to higher detail (object got bigger): require s above that boundary, widened.
		if (s < BOUNDARIES[currentLod - 1] / HYST) return currentLod
	} else {
		// Moving to lower detail (object got smaller): require s below that boundary, narrowed.
		if (s > BOUNDARIES[currentLod] * HYST) return currentLod
	}
	return raw
}
