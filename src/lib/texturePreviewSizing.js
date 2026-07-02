// texturePreviewSizing — pure helpers for the multi-instance TexturePreviewFloater.
// Mirrors Firestorm's llpreviewtexture.cpp sizing + floater_preview_texture.xml aspect list.
// Kept side-effect-free (no DOM, no Vue) so it is unit-testable in isolation.

// FS aspect-ratio dropdown options (floater_preview_texture.xml "combo_aspect_ratio"), in order.
// 'Unconstrained' (value 0) = object-fit:contain, no forced ratio. The rest are w:h.
export const ASPECT_OPTIONS = [
	{ label: 'Unconstrained', ratio: null },
	{ label: '1:1',   ratio: 1 / 1 },
	{ label: '4:3',   ratio: 4 / 3 },
	{ label: '10:7',  ratio: 10 / 7 },
	{ label: '3:2',   ratio: 3 / 2 },
	{ label: '16:10', ratio: 16 / 10 },
	{ label: '16:9',  ratio: 16 / 9 },
	{ label: '2:1',   ratio: 2 / 1 },
]

// Chrome overhead (px) added around the image area for the title bar + aspect dropdown + padding.
// Kept as a constant so the sizing math and the tests agree on one number.
export const CHROME_W = 24    // 2 × 12px horizontal padding
export const CHROME_H = 92    // title bar + dropdown row + vertical padding

export const MIN_W = 400
export const MIN_H = 200

// Cap on simultaneously-open previews (FS lets you open many; we bound heap). Oldest closes past this.
export const MAX_TEXTURE_PREVIEWS = 12

function gcd(a, b) {
	a = Math.abs(Math.round(a))
	b = Math.abs(Math.round(b))
	while (b) { [a, b] = [b, a % b] }
	return a || 1
}

/**
 * Reduce a pixel size to its lowest-terms ratio label, matching a fixed ASPECT_OPTIONS entry when
 * possible. FS: 1024×512 → '2:1' (a fixed option); 1024×683 → custom '683:1024' (w:h, reduced).
 * Returns { label, ratio } where ratio = w/h. For a custom size the label is `${rw}:${rh}`.
 * @param {number} w naturalWidth
 * @param {number} h naturalHeight
 */
export function computeAspect(w, h) {
	if (!w || !h || w <= 0 || h <= 0) return { label: 'Unconstrained', ratio: null }
	const g = gcd(w, h)
	const rw = Math.round(w / g)
	const rh = Math.round(h / g)
	const ratio = w / h
	// Match a fixed option within a small tolerance (float ratios like 10/7 aren't exact).
	const match = ASPECT_OPTIONS.find(o => o.ratio != null && Math.abs(o.ratio - ratio) < 1e-4)
	if (match) return { label: match.label, ratio: match.ratio }
	return { label: `${rw}:${rh}`, ratio }
}

/**
 * Build the option list for a given texture size: the fixed FS options, plus (if the texture's
 * reduced ratio doesn't match one) an appended custom option. Returns { options, selectedLabel }.
 */
export function buildAspectOptions(w, h) {
	const aspect = computeAspect(w, h)
	const isFixed = ASPECT_OPTIONS.some(o => o.label === aspect.label)
	if (isFixed || aspect.ratio == null) {
		return { options: ASPECT_OPTIONS, selectedLabel: aspect.label }
	}
	return { options: [...ASPECT_OPTIONS, aspect], selectedLabel: aspect.label }
}

/**
 * FS sizing rule (llpreviewtexture.cpp): fit the floater to the image at NATIVE pixels, but if
 * either dimension exceeds the viewport, show it at HALF resolution. No fixed 512 cap. Add chrome
 * overhead, clamp to MIN, and nudge the position so the resized floater stays on-screen.
 *
 * @param {number} natW naturalWidth  (px)
 * @param {number} natH naturalHeight (px)
 * @param {number} viewportW window.innerWidth
 * @param {number} viewportH window.innerHeight
 * @param {{left:number, top:number}} [curPos] current floater top-left (px) for on-screen nudge
 * @returns {{ width:number, height:number, left:(number|null), top:(number|null) }}
 *   width/height = outer floater size (px). left/top = nudged position, or null if curPos absent.
 */
export function computePreviewSize(natW, natH, viewportW, viewportH, curPos = null) {
	let imgW = Math.max(1, Math.round(natW || 0))
	let imgH = Math.max(1, Math.round(natH || 0))

	// Half-res when either native dimension overflows the viewport (FS: divide by 2, no 512 cap).
	if (imgW > viewportW || imgH > viewportH) {
		imgW = Math.round(imgW / 2)
		imgH = Math.round(imgH / 2)
	}

	let width  = Math.max(MIN_W, imgW + CHROME_W)
	let height = Math.max(MIN_H, imgH + CHROME_H)

	// Never let the floater exceed the viewport itself (a half-res giant can still be huge).
	width  = Math.min(width,  Math.max(MIN_W, viewportW))
	height = Math.min(height, Math.max(MIN_H, viewportH))

	let left = null
	let top  = null
	if (curPos) {
		left = curPos.left
		top  = curPos.top
		// Nudge back on-screen if the resized floater would overflow the right/bottom edge.
		if (left + width  > viewportW) left = viewportW - width
		if (top  + height > viewportH) top  = viewportH - height
		left = Math.max(0, left)
		top  = Math.max(0, top)
	}

	return { width, height, left, top }
}
