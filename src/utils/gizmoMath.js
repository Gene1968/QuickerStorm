// src/utils/gizmoMath.js — pure math for gizmo drag interactions (move/rotate/scale handles).
// Ported from Firestorm's LLManip family (indra/newview/llmanip*.cpp). No scene/mesh/renderer
// references — only THREE.Vector3/Quaternion for vector math — so this stays unit-testable
// without mounting a renderer. Inputs/outputs are plain {x,y,z} (duck-types with THREE.Vector3
// too, since callers may pass one in without converting).
import * as THREE from 'three'

const _v = (p) => new THREE.Vector3(p.x, p.y, p.z)
const _out = (v) => ({ x: v.x, y: v.y, z: v.z })

/**
 * Ray/plane intersection — FS LLViewerWindow::mousePointOnPlaneGlobal (llviewerwindow.cpp:5733-
 * 5758): point = rayOrigin + t·rayDir, where t = dot(normal, planeOrigin - rayOrigin) / dot(normal,
 * rayDir). Returns null when the ray is (near-)parallel to the plane (FS falls back to a
 * degenerate closest-point case we don't need — see PKG-2 FEATURE-GAPS note) or when the
 * intersection is behind the ray origin (FS's `mouse_look_at_scale > 0.0` return-value check).
 */
export function mouseRayPlaneIntersect(rayOrigin, rayDir, planeOrigin, planeNormal) {
	const o = _v(rayOrigin)
	const d = _v(rayDir).normalize()
	const p = _v(planeOrigin)
	const n = _v(planeNormal).normalize()
	const denom = d.dot(n)
	if (Math.abs(denom) < 1e-6) return null
	const t = p.clone().sub(o).dot(n) / denom
	if (t <= 0) return null
	return _out(o.addScaledVector(d, t))
}

/**
 * Scalar displacement of `delta` along `axis` — FS LLManipTranslate::handleHover (llmaniptranslate
 * .cpp:558: `axis_magnitude = relative_move * axis_d`, fed by the plane-projection code at
 * :537-551 — dot product of the plane-projected cursor displacement against the constrained
 * axis). Axis need not be pre-normalized.
 */
export function projectDeltaOntoAxis(delta, axis) {
	const d = _v(delta)
	const a = _v(axis).normalize()
	return d.dot(a)
}

/**
 * Signed rotation angle (radians) of `curVec` relative to `startVec` about `axis`, pivoting at
 * `center` — matches FS LLManipRotate's unconstrained free-rotate angle (llmaniprotate.cpp:
 * 1682-1688: `cross = mMouseDown % mMouseCur; angle = atan2(|cross|, dot)`, sign from cross·axis);
 * the snap-quantized ring branch at :1564/:1650 (two-atan2 difference on explicit in-plane
 * reference axes) is a separate FS feature we deliberately don't port yet (grid snap — see
 * docs/FEATURE-GAPS.md 2026-07-13). This uses the equivalent signed-angle-about-an-axis identity
 * `atan2(axis·(a×b), a·b)`, which needs no arbitrary reference-axis choice and is exact for any
 * two vectors that share `axis` as their (near-)normal. `startVec`/`curVec` are absolute points
 * (e.g. plane-intersection hits from mouseRayPlaneIntersect); this function subtracts `center` and
 * projects out any residual component along `axis` (numerical safety for near-in-plane inputs).
 */
export function ringAngle(center, axis, startVec, curVec) {
	const c = _v(center)
	const ax = _v(axis).normalize()
	const a = _v(startVec).sub(c)
	const b = _v(curVec).sub(c)
	a.sub(ax.clone().multiplyScalar(a.dot(ax)))
	b.sub(ax.clone().multiplyScalar(b.dot(ax)))
	if (a.lengthSq() < 1e-10 || b.lengthSq() < 1e-10) return 0
	const cross = new THREE.Vector3().crossVectors(a, b)
	return Math.atan2(cross.dot(ax), a.dot(b))
}

/**
 * Closest-approach parameter `t` (such that the nearest point is `lineA + t·(lineB-lineA)`)
 * between the mouse ray and the line through lineA/lineB — FS LLManip::nearestPointOnLineFromMouse
 * (llmanip.cpp:302-351, second block computing `b_param`): normal = (a×b)×a is the plane through
 * the mouse ray `a` that also contains the shortest connecting segment; intersecting line `b` with
 * that plane gives the closest-approach point on `b`. FS's first block (a_param, the symmetric
 * calc for the mouse ray) isn't needed here — scale-drag only cares where along the handle axis
 * the closest approach falls. Returns 0 when the ray is parallel to the line (degenerate, e.g.
 * viewing exactly down the axis) rather than NaN, so callers can treat it as "no movement yet".
 */
export function nearestPointOnLineParam(rayOrigin, rayDir, lineA, lineB) {
	const a1 = _v(rayOrigin)
	const a = _v(rayDir).normalize()
	const b1 = _v(lineA)
	const b2 = _v(lineB)
	const b = b2.clone().sub(b1)

	const ab = new THREE.Vector3().crossVectors(a, b)
	if (ab.lengthSq() < 1e-10) return 0   // parallel lines — no well-defined closest approach
	const nb = ab.cross(a).normalize()    // (a×b)×a
	const denom = nb.dot(b)
	if (Math.abs(denom) < 1e-6) return 0
	const dist = a1.dot(nb)
	return (dist - nb.dot(b1)) / denom
}

/**
 * Lighten a 24-bit hex color toward white by `amount` (0..1) — the gizmo hover-highlight variant.
 * FS's manipulator hover state swaps to a literal highlight color rather than tinting (see
 * LLManipScale::conditionalHighlight, llmanipscale.cpp:151-176: `default_highlight` = flat white vs
 * `default_normal` = 0.7,0.7,0.7 dimmed-white, selected by `mHighlightedPart == part`); we blend
 * toward white instead of swapping to a flat white/gray so each axis keeps its own recognizable hue
 * under the FS RGB=XYZ convention used elsewhere in this codebase (buildGizmoForMode's _GIZMO_X/Y/Z).
 */
export function lightenColor(hex, amount = 0.5) {
	const r = (hex >> 16) & 0xff, g = (hex >> 8) & 0xff, b = hex & 0xff
	const t = Math.max(0, Math.min(1, amount))
	const lr = Math.round(r + (255 - r) * t)
	const lg = Math.round(g + (255 - g) * t)
	const lb = Math.round(b + (255 - b) * t)
	return (lr << 16) | (lg << 8) | lb
}
