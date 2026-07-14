// src/lib/primParams.js — FS-parity display/inverse mapping between RAW ObjectShape wire ints
// (worldStore obj.shape.* — decoded server/lib/lludp-codec.ts:2020-2039) and the Object-tab UI
// float fields. Ported from phoenix-firestorm indra/newview/llpanelobject.cpp:
//   getState()        :866-1025 (S/T cut swap :897-923, twist :925-943, top-size/hole-size :1125-1187)
//   getVolumeParams()  :1930-2025 (inverse: cut clamp OBJECT_MIN_CUT_INC, twist undo, 1-x undo)
// Quantization constants — llvolumemessage.cpp:39-263 (packProfileParams/packPathParams), the SAME
// formulas server/lib/lludp-codec.ts's encodeObjectAdd already uses. Cross-checked against
// src/lib/primMesher.js:769-832 (shapeToPrimMesh), which dequantizes the identical raw fields for
// mesh tessellation — any formula here must agree with that file.
//
// WHY no separate "raw Taper X/Y" row: FS actually has TWO distinct X/Y pairs in this panel —
// "Taper Scale X/Y" (PathScaleX/Y, the row this module calls "Taper"/"Hole Size") AND a separate
// "Taper X/Y" control bound directly to the PathTaperX/Y S8 field (llpanelobject.cpp:280-283,
// getState:953-959). Gene's spec for this pass only asks for the former as an editable row; the
// latter's raw dequant is carried through unchanged by uiToWireParams (see pathTaperX/Y below) —
// documented gap: docs/FEATURE-GAPS.md (dated entry, no UI row edits PathTaperX/Y yet).

import { PROFILE_CIRCLE, PROFILE_SQUARE, PROFILE_ISOTRI, PROFILE_EQUALTRI, PROFILE_RIGHTTRI, PROFILE_CIRCLE_HALF, PATH_LINE, PATH_CIRCLE } from '@/lib/primShapes.js'

// llvolume.h:165,167 — not exported by primShapes.js (only the 13 basic-prim-button curves live
// there); needed here to replicate FS's full getState() path-type switch.
const PATH_CIRCLE2  = 0x30
const PATH_FLEXIBLE = 0x80
const PROFILE_MASK  = 0x0f  // llvolume.h:139 LL_PCODE_PROFILE_MASK

// Quantization constants — llvolume.h:75-80 / llvolumemessage.cpp:39-263 (message_template.msg's
// inline "quanta=0.01" comments for cut/hollow are stale — see lludp-codec.ts's identical note).
const CUT_QUANTA    = 0.00002
const SCALE_QUANTA  = 0.01
const SHEAR_QUANTA  = 0.01
const TAPER_QUANTA  = 0.01
const REV_QUANTA    = 0.015
const HOLLOW_QUANTA = 0.00002

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/** RAW wire ints (worldStore obj.shape) → FLOAT volume-params, FS LLVolumeParams getter space.
 *  Formulas mirror llvolumemessage.cpp unpackPathParams/unpackProfileParams exactly (verified
 *  against primMesher.js:778-830's independent port of the same fields). */
export function dequantShape(shape) {
	const s = shape || {}
	const n = (v, d = 0) => (v == null ? d : v)
	return {
		pathCurve:    n(s.pathCurve, PATH_LINE),
		profileCurve: n(s.profileCurve, PROFILE_SQUARE),
		// llvolumemessage.cpp:334,338/108-128 — begin: wire*quanta; end: 1 - wire*quanta.
		pathBegin:    n(s.pathBegin) * CUT_QUANTA,
		pathEnd:      1 - n(s.pathEnd) * CUT_QUANTA,
		profileBegin: n(s.profileBegin) * CUT_QUANTA,
		profileEnd:   1 - n(s.profileEnd) * CUT_QUANTA,
		hollow:       n(s.profileHollow) * HOLLOW_QUANTA,
		// :356,360/425-433 — S8 fields dequant as wire*quanta (already signed by the codec's readInt8).
		twist:            n(s.pathTwist) * SCALE_QUANTA,
		twistBegin:       n(s.pathTwistBegin) * SCALE_QUANTA,
		taperX:           n(s.pathTaperX) * TAPER_QUANTA,   // raw PathTaperX/Y field — see file header WHY
		taperY:           n(s.pathTaperY) * TAPER_QUANTA,
		shearX:           n(s.pathShearX) * SHEAR_QUANTA,
		shearY:           n(s.pathShearY) * SHEAR_QUANTA,
		radiusOffset:     n(s.pathRadiusOffset) * SCALE_QUANTA,
		skew:             n(s.pathSkew) * SCALE_QUANTA,
		// :343-345/375 — the "ratio" (FS getRatioX/Y): (200-wire)*quanta, range 0..1 for wire 100..200.
		scaleX:       (200 - n(s.pathScaleX, 100)) * SCALE_QUANTA,
		scaleY:       (200 - n(s.pathScaleY, 100)) * SCALE_QUANTA,
		revolutions:  1 + n(s.pathRevolutions) * REV_QUANTA,
	}
}

// Basic-prim shape identification — llpanelobject.cpp getState():740-844 path/profile switch,
// trimmed to the 7 types this Object-tab pass supports (box/cylinder/prism/sphere/torus/tube/ring).
// Unrecognized path+profile combos (the FS "Working33"/PATH_TEST/CIRCLE2 exotic profiles, or a
// malformed shape) return null per spec — callers fall back to linear (Slice/Taper) UI behavior.
export function shapeKind(shape) {
	if (!shape) return null
	const path = shape.pathCurve ?? PATH_LINE
	const profile = (shape.profileCurve ?? PROFILE_SQUARE) & PROFILE_MASK
	const linear = path === PATH_LINE || path === PATH_FLEXIBLE
	if (linear) {
		if (profile === PROFILE_CIRCLE) return 'cylinder'
		if (profile === PROFILE_SQUARE) return 'box'
		if (profile === PROFILE_ISOTRI || profile === PROFILE_EQUALTRI || profile === PROFILE_RIGHTTRI) return 'prism'
		return null
	}
	// Scale goes first so we can differentiate sphere vs torus — same profile/path (:733-738).
	const scaleY = (200 - (shape.pathScaleY ?? 100)) * SCALE_QUANTA
	if (path === PATH_CIRCLE && profile === PROFILE_CIRCLE) return scaleY > 0.75 ? 'sphere' : 'torus'
	if (path === PATH_CIRCLE && profile === PROFILE_CIRCLE_HALF) return 'sphere'
	if (path === PATH_CIRCLE2 && profile === PROFILE_CIRCLE) return 'sphere'   // spirals unsupported → sphere (:777-781)
	if (path === PATH_CIRCLE && profile === PROFILE_EQUALTRI) return 'ring'
	if (path === PATH_CIRCLE && profile === PROFILE_SQUARE && scaleY <= 0.75) return 'tube'
	return null
}

const HOLE_FAMILY = new Set(['sphere', 'torus', 'tube', 'ring'])
const ADV_LABEL = { sphere: 'Dimple', torus: 'Profile Cut', tube: 'Profile Cut', ring: 'Profile Cut' }

/** shape → UI-facing display rows (all FLOATs/percent/degrees, ready for `.toFixed(n)`).
 *  Row semantics per llpanelobject.cpp getState() — see per-field cites below. */
export function displayParams(shape) {
	const d = dequantShape(shape)
	const kind = shapeKind(shape)
	const linear = d.pathCurve === PATH_LINE || d.pathCurve === PATH_FLEXIBLE
	const circular = !linear
	// :897-923 — sphere/torus/tube/ring's PRIMARY cut is the PATH (T) range; everything else (incl.
	// unrecognized shapes, matching FS's "assume MI_BOX" fallback) primary cut is the PROFILE (S) range.
	const cutUsesT = HOLE_FAMILY.has(kind)
	const pathCutBegin = cutUsesT ? d.pathBegin : d.profileBegin
	const pathCutEnd   = cutUsesT ? d.pathEnd   : d.profileEnd
	const advBegin      = cutUsesT ? d.profileBegin : d.pathBegin
	const advEnd        = cutUsesT ? d.profileEnd   : d.pathEnd
	const advLabel = ADV_LABEL[kind] ?? 'Slice'   // box/cylinder/prism/null → "Slice" (:1106-1119)
	// :1125-1187 — hole family shows the RAW ratio labeled "Hole Size"; box/cyl/prism (and the
	// unrecognized-shape fallback) show 1-ratio labeled "Taper".
	const isHoleFamily = HOLE_FAMILY.has(kind)
	const taperLabel = isHoleFamily ? 'Hole Size' : 'Taper'
	const taperX = isHoleFamily ? d.scaleX : 1 - d.scaleX
	const taperY = isHoleFamily ? d.scaleY : 1 - d.scaleY
	// :929-938 — twist stored as -1..1 "volume" units; ×180 linear paths, ×360 circular
	// (llprimitive.cpp:54-62 OBJECT_TWIST_LINEAR_MAX/OBJECT_TWIST_MAX).
	const twistMult = linear ? 180 : 360
	return {
		kind, linear, circular,
		pathCutBegin, pathCutEnd,
		advBegin, advEnd, advLabel,
		hollowPct: d.hollow * 100,   // :866-868 — hollow displayed ×100 (percent)
		twistBegin: d.twistBegin * twistMult,
		twistEnd:   d.twist * twistMult,
		taperX, taperY, taperLabel,
		// Spinner ranges — box/cyl/prism Taper ±1 (:1163-1166); Hole Size X 0..1/mMinHoleSize..1,
		// Y 0..1/mMinHoleSize..0.5 (:1133-1151, OBJECT_MAX_HOLE_SIZE_X/Y llprimitive.cpp:73-74).
		// mMinHoleSize is a per-region cap (LLWorld::getRegionMinHoleSize) we don't have client-side;
		// 0.05 is OpenSim's compiled-in default (llprimitive.cpp OBJECT_MIN_HOLE_SIZE-equivalent).
		taperXRange: isHoleFamily ? [0.05, kind === 'sphere' ? 1.0 : 1.0] : [-1, 1],
		taperYRange: isHoleFamily ? [0.05, kind === 'sphere' ? 1.0 : 0.5] : [-1, 1],
		shearX: d.shearX, shearY: d.shearY,
		radiusOffset: d.radiusOffset,
		revolutions: d.revolutions,
		skew: d.skew,
		// :1071-1086 — radius offset/revolutions/skew only meaningful (and shown) for circular
		// (torus-family + sphere) paths; box/cylinder/prism hide them.
		showRadiusRevSkew: circular,
	}
}

// OBJECT_MIN_CUT_INC — llprimitive.cpp:51 (0.02). At least this much of the object must survive
// between a cut pair's begin/end (getVolumeParams:1930-1945).
const MIN_CUT_INC = 0.02

/** (original shape, edited UI rows) → the FULL 17-field FLOAT param set for the ObjectShape wire
 *  (shared/protocol.js C.OBJECT_SHAPE). Inverse of displayParams — clamps per FS xui ranges
 *  (getVolumeParams:1926-2025) then undoes the S/T swap, 1-x taper, and twist scale. pathCurve/
 *  profileCurve and the raw PathTaperX/Y field pass through unchanged from `shape` — this pass has
 *  no UI control for prim TYPE or the raw Taper X/Y row (see file header WHY). */
export function uiToWireParams(shape, ui) {
	const d = dequantShape(shape)
	const kind = shapeKind(shape)
	const linear = d.pathCurve === PATH_LINE || d.pathCurve === PATH_FLEXIBLE
	const cutUsesT = HOLE_FAMILY.has(kind)
	const isHoleFamily = cutUsesT

	// Cut pairs — each clamped 0..1 then given at least MIN_CUT_INC of headroom (:1930-1945).
	const clampCut = (b, e) => {
		let cb = clamp(b, 0, 1), ce = clamp(e, 0, 1)
		if (cb > ce - MIN_CUT_INC) cb = ce - MIN_CUT_INC
		return [cb, ce]
	}
	const [pcb, pce] = clampCut(ui.pathCutBegin, ui.pathCutEnd)
	const [acb, ace] = clampCut(ui.advBegin, ui.advEnd)
	const pathBegin    = cutUsesT ? pcb : acb
	const pathEnd      = cutUsesT ? pce : ace
	const profileBegin = cutUsesT ? acb : pcb
	const profileEnd   = cutUsesT ? ace : pce

	// Hollow — /100 back to unit range, capped 0.95 (primMesher.js:788 mirrors the same cap for mesh gen).
	const profileHollow = clamp((ui.hollowPct ?? 0) / 100, 0, 0.95)

	// Twist — undo the ×180/×360 display scale (:1991-2000).
	const twistMax = linear ? 180 : 360
	const pathTwistBegin = clamp(ui.twistBegin ?? 0, -twistMax, twistMax) / twistMax
	const pathTwist       = clamp(ui.twistEnd   ?? 0, -twistMax, twistMax) / twistMax

	const pathShearX = clamp(ui.shearX ?? 0, -0.5, 0.5)
	const pathShearY = clamp(ui.shearY ?? 0, -0.5, 0.5)
	const pathRadiusOffset = clamp(ui.radiusOffset ?? 0, -1, 1)
	const pathRevolutions  = clamp(ui.revolutions ?? 1, 1, 4)
	const pathSkew         = clamp(ui.skew ?? 0, -0.95, 0.95)

	// Taper/Hole-Size row → PathScaleX/Y ratio: hole family = raw value (clamped to its xui range);
	// box/cyl/prism = 1 - displayed taper (:2005-2012).
	let pathScaleX, pathScaleY
	if (isHoleFamily) {
		pathScaleX = clamp(ui.taperX ?? 1, 0.05, 1.0)
		pathScaleY = clamp(ui.taperY ?? 1, 0.05, 0.5)
	} else {
		pathScaleX = 1 - clamp(ui.taperX ?? 0, -1, 1)
		pathScaleY = 1 - clamp(ui.taperY ?? 0, -1, 1)
	}

	return {
		pathCurve: d.pathCurve, profileCurve: d.profileCurve,
		pathBegin, pathEnd, profileBegin, profileEnd, profileHollow,
		pathTwist, pathTwistBegin,
		pathScaleX, pathScaleY,
		pathShearX, pathShearY,
		pathTaperX: d.taperX, pathTaperY: d.taperY,   // passthrough — no UI row (see file header WHY)
		pathRevolutions, pathRadiusOffset, pathSkew,
	}
}
