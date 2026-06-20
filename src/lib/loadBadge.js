// src/lib/loadBadge.js — pure view logic for the scene-load badge (SceneLoadBadge.vue).
//
// The badge surfaces the deepest-incomplete asset pipeline so it never reads "done" while the scene is
// still loading. Priority (deepest first): region entry → prim geometry % → object (mesh/sculpt)
// downloads → textures → hidden. WHY object downloads need their own stage: a mesh/sculpt object's
// placeholder box is already in meshMap, so geometry `pct` reaches 100 while the object is still a cube
// awaiting its asset (Bountiful 2026-06-19: pct=100, textures warm, badge hidden, ~460 meshes trickling
// for 15min). Counts are live queue depths refreshed ~every 3s, so a multi-minute trickle shows as a
// ticking count. Pure + total (no THREE/DOM/store) so the priority logic is unit-testable.
// See docs/superpowers/specs/2026-06-19-multi-pipeline-load-badge-design.md.

/**
 * @param {object} cs   worldStore.cullStats: { resident, known, evicted, pct, atTarget, massive,
 *                      effNear, texPending, texFailed, objPending, objFailed }
 * @param {boolean} entering  region-entry phase (no objects have arrived yet)
 * @param {number} terrainPatchCount  terrain patches received so far (distinguishes the entry sub-state)
 * @returns {{ show: boolean, label: string, title: string }}
 */
export function loadBadgeView(cs, entering, terrainPatchCount = 0) {
	const pct = cs?.pct ?? 100
	const objPending = cs?.objPending ?? 0
	const texPending = cs?.texPending ?? 0

	const show = !!entering || pct < 100 || objPending > 0 || texPending > 0

	let label
	if (entering) {
		label = terrainPatchCount > 0 ? 'Loading terrain…' : 'Entering region…'
	} else if (pct < 100) {
		const phase = cs?.atTarget ? 'Overall scene' : 'Nearby scene'
		const preface = cs?.massive ? 'Major new scenery to cache: ' : ''
		label = `${preface}${phase} ${pct}% loaded`
	} else if (objPending > 0) {
		label = `Objects ${objPending} downloading`
	} else if (texPending > 0) {
		label = `Textures ${texPending} left`
	} else {
		label = ''   // not shown
	}

	return { show, label, title: buildTitle(cs) }
}

function buildTitle(cs) {
	const resident = cs?.resident ?? 0
	const known = cs?.known ?? 0
	const effNear = cs?.effNear ?? 0
	const objPending = cs?.objPending ?? 0
	const texPending = cs?.texPending ?? 0
	const evicted = cs?.evicted ?? 0
	let title = `Resident ${resident} / known ${known} within ${effNear}m draw distance`
	if (objPending > 0) title += ` · objects ${objPending} downloading`
	if (texPending > 0) title += ` · textures ${texPending} left`
	title += ` · evicted ${evicted} for memory`
	const objFailed = cs?.objFailed ?? 0
	const texFailed = cs?.texFailed ?? 0
	if (objFailed > 0 || texFailed > 0) {
		const parts = []
		if (objFailed > 0) parts.push(`${objFailed} objects`)
		if (texFailed > 0) parts.push(`${texFailed} textures`)
		title += ` · ${parts.join(' / ')} failed (right-click an object → Texture refresh)`
	}
	return title
}
