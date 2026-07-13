// src/lib/primShapes.js — Create-tool shape table: one LLVolumeParams-equivalent entry per basic
// prim, ported EXACTLY from the FS switch(pcode) in lltoolplacer.cpp (per-shape case block, see
// per-entry cite below). Each entry yields the FULL unquantized param set for the
// C.OBJECT_ADD wire contract (shared/protocol.js) — the server quantizes on encode.
//
// Reference: phoenix-firestorm indra/newview/lltoolplacer.cpp:338-482 (LLToolPlacer::addObject
// switch(pcode)) and indra/llmath/llvolume.h (curve enums + LLProfileParams/LLPathParams ctor
// defaults, cited per constant below).

// ── LLVolume profile/path curve enums (llvolume.h:139-168) ────────────────────────────────────
export const PROFILE_CIRCLE      = 0x00 // llvolume.h:141
export const PROFILE_SQUARE      = 0x01 // llvolume.h:142
export const PROFILE_ISOTRI      = 0x02 // llvolume.h:143
export const PROFILE_EQUALTRI    = 0x03 // llvolume.h:144
export const PROFILE_RIGHTTRI    = 0x04 // llvolume.h:145
export const PROFILE_CIRCLE_HALF = 0x05 // llvolume.h:146
export const PATH_LINE           = 0x10 // llvolume.h:160
export const PATH_CIRCLE         = 0x20 // llvolume.h:161

// LL_PCODE_VOLUME — the object PCode for every LLVolumeParams-based prim (llvolume.h:102).
export const PCODE_VOLUME = 9

// 90°-about-Y quaternion [x,y,z,w] — FS: rotation.setQuat(90.f * DEG_TO_RAD, LLVector3::y_axis)
// (lltoolplacer.cpp:341,353,365,377). LLQuaternion::setQuat(angle,axis) packs
// (axis*sin(angle/2), cos(angle/2)) into mQ[VX,VY,VZ,VS] (llquaternion.cpp:234-253,
// llquaternion.h:53,184-187 — mQ order IS x,y,z,w). angle/2 = 45° → sin=cos=Math.SQRT1_2.
const ROTATION_Y90 = [0, Math.SQRT1_2, 0, Math.SQRT1_2]
const ROTATION_IDENTITY = [0, 0, 0, 1]

// Shared LLProfileParams/LLPathParams ctor defaults not overridden by any basic-prim case
// (llvolume.h:214-221 LLProfileParams(), llvolume.h:340-355 LLPathParams()): hollow=0, twist=0,
// twistBegin=0, radiusOffset=0, taper=(0,0), revolutions=1, skew=0.
function baseParams() {
	return {
		pcode: PCODE_VOLUME,
		profileHollow: 0,
		pathTwist: 0,
		pathTwistBegin: 0,
		pathRadiusOffset: 0,
		pathTaperX: 0,
		pathTaperY: 0,
		pathRevolutions: 1,
		pathSkew: 0,
	}
}

// One entry per FS lltoolplacer.cpp case. Fields map 1:1 to LLVolumeParams setters:
//   setType(profile,path) → profileCurve/pathCurve
//   setBeginAndEndS(b,e)  → profileBegin/profileEnd (S range)
//   setBeginAndEndT(b,e)  → pathBegin/pathEnd (T range)
//   setRatio(x,y)         → pathScaleX/pathScaleY
//   setShear(x,y)         → pathShearX/pathShearY
export const PRIM_SHAPES = {
	// lltoolplacer.cpp:398-406
	cube: {
		...baseParams(),
		profileCurve: PROFILE_SQUARE, pathCurve: PATH_LINE,
		profileBegin: 0, profileEnd: 1, pathBegin: 0, pathEnd: 1,
		pathScaleX: 1, pathScaleY: 1, pathShearX: 0, pathShearY: 0,
		rotation: ROTATION_IDENTITY,
	},
	// lltoolplacer.cpp:408-416
	prism: {
		...baseParams(),
		profileCurve: PROFILE_SQUARE, pathCurve: PATH_LINE,
		profileBegin: 0, profileEnd: 1, pathBegin: 0, pathEnd: 1,
		pathScaleX: 0, pathScaleY: 1, pathShearX: -0.5, pathShearY: 0,
		rotation: ROTATION_IDENTITY,
	},
	// lltoolplacer.cpp:418-426
	pyramid: {
		...baseParams(),
		profileCurve: PROFILE_SQUARE, pathCurve: PATH_LINE,
		profileBegin: 0, profileEnd: 1, pathBegin: 0, pathEnd: 1,
		pathScaleX: 0, pathScaleY: 0, pathShearX: 0, pathShearY: 0,
		rotation: ROTATION_IDENTITY,
	},
	// lltoolplacer.cpp:428-436
	tetrahedron: {
		...baseParams(),
		profileCurve: PROFILE_EQUALTRI, pathCurve: PATH_LINE,
		profileBegin: 0, profileEnd: 1, pathBegin: 0, pathEnd: 1,
		pathScaleX: 0, pathScaleY: 0, pathShearX: 0, pathShearY: 0,
		rotation: ROTATION_IDENTITY,
	},
	// lltoolplacer.cpp:438-446
	cylinder: {
		...baseParams(),
		profileCurve: PROFILE_CIRCLE, pathCurve: PATH_LINE,
		profileBegin: 0, profileEnd: 1, pathBegin: 0, pathEnd: 1,
		pathScaleX: 1, pathScaleY: 1, pathShearX: 0, pathShearY: 0,
		rotation: ROTATION_IDENTITY,
	},
	// lltoolplacer.cpp:448-456 (LL_PCODE_CYLINDER_HEMI — S cut to 0.25..0.75)
	hemicylinder: {
		...baseParams(),
		profileCurve: PROFILE_CIRCLE, pathCurve: PATH_LINE,
		profileBegin: 0.25, profileEnd: 0.75, pathBegin: 0, pathEnd: 1,
		pathScaleX: 1, pathScaleY: 1, pathShearX: 0, pathShearY: 0,
		rotation: ROTATION_IDENTITY,
	},
	// lltoolplacer.cpp:458-466
	cone: {
		...baseParams(),
		profileCurve: PROFILE_CIRCLE, pathCurve: PATH_LINE,
		profileBegin: 0, profileEnd: 1, pathBegin: 0, pathEnd: 1,
		pathScaleX: 0, pathScaleY: 0, pathShearX: 0, pathShearY: 0,
		rotation: ROTATION_IDENTITY,
	},
	// lltoolplacer.cpp:468-476 (LL_PCODE_CONE_HEMI — S cut to 0.25..0.75)
	hemicone: {
		...baseParams(),
		profileCurve: PROFILE_CIRCLE, pathCurve: PATH_LINE,
		profileBegin: 0.25, profileEnd: 0.75, pathBegin: 0, pathEnd: 1,
		pathScaleX: 0, pathScaleY: 0, pathShearX: 0, pathShearY: 0,
		rotation: ROTATION_IDENTITY,
	},
	// lltoolplacer.cpp:340-350 — sphere: 90°-Y rotation quirk, profile=CIRCLE_HALF/path=CIRCLE.
	sphere: {
		...baseParams(),
		profileCurve: PROFILE_CIRCLE_HALF, pathCurve: PATH_CIRCLE,
		profileBegin: 0, profileEnd: 1, pathBegin: 0, pathEnd: 1,
		pathScaleX: 1, pathScaleY: 1, pathShearX: 0, pathShearY: 0,
		rotation: ROTATION_Y90,
	},
	// lltoolplacer.cpp:388-396 (LL_PCODE_SPHERE_HEMI — no rotation set; T cut to 0..0.5, S left at
	// the LLProfileParams ctor default 0..1, the setBeginAndEndS(0.5,1) call is commented out).
	hemisphere: {
		...baseParams(),
		profileCurve: PROFILE_CIRCLE_HALF, pathCurve: PATH_CIRCLE,
		profileBegin: 0, profileEnd: 1, pathBegin: 0, pathEnd: 0.5,
		pathScaleX: 1, pathScaleY: 1, pathShearX: 0, pathShearY: 0,
		rotation: ROTATION_IDENTITY,
	},
	// lltoolplacer.cpp:352-362 — torus: 90°-Y rotation quirk, ratio(1, 0.25) "top size".
	torus: {
		...baseParams(),
		profileCurve: PROFILE_CIRCLE, pathCurve: PATH_CIRCLE,
		profileBegin: 0, profileEnd: 1, pathBegin: 0, pathEnd: 1,
		pathScaleX: 1, pathScaleY: 0.25, pathShearX: 0, pathShearY: 0,
		rotation: ROTATION_Y90,
	},
	// lltoolplacer.cpp:364-374 — FS "square torus" = tube: profile=SQUARE, path=CIRCLE.
	tube: {
		...baseParams(),
		profileCurve: PROFILE_SQUARE, pathCurve: PATH_CIRCLE,
		profileBegin: 0, profileEnd: 1, pathBegin: 0, pathEnd: 1,
		pathScaleX: 1, pathScaleY: 0.25, pathShearX: 0, pathShearY: 0,
		rotation: ROTATION_Y90,
	},
	// lltoolplacer.cpp:376-386 — FS "triangle torus" = ring: profile=EQUALTRI, path=CIRCLE.
	ring: {
		...baseParams(),
		profileCurve: PROFILE_EQUALTRI, pathCurve: PATH_CIRCLE,
		profileBegin: 0, profileEnd: 1, pathBegin: 0, pathEnd: 1,
		pathScaleX: 1, pathScaleY: 0.25, pathShearX: 0, pathShearY: 0,
		rotation: ROTATION_Y90,
	},
}

// Ordered key list — drives the Create-tab shape button grid (image buttons in
// ObjectEditFloater.vue keep this same left-to-right order).
export const PRIM_SHAPE_KEYS = [
	'cube', 'prism', 'pyramid', 'tetrahedron', 'cylinder', 'hemicylinder',
	'cone', 'hemicone', 'sphere', 'hemisphere', 'torus', 'tube', 'ring',
]

/** Fresh copy of a shape's param table (safe for callers to spread/mutate), or null for an
 *  unknown key. rotation is cloned too so a caller can't mutate the shared constant array. */
export function getPrimShape(key) {
	const shape = PRIM_SHAPES[key]
	if (!shape) return null
	return { ...shape, rotation: [...shape.rotation] }
}
