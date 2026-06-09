// src/lib/primFaceMap.js — pure mapping from a Three.js geometry group's materialIndex to the
// SL TextureEntry face index, for prims whose face layout we can map exactly.
//
// WHY: Three's BoxGeometry/CylinderGeometry emit material groups (box mi 0..5 = +X,-X,+Y,-Y,+Z,-Z;
// cylinder mi 0..2 = side,top,bottom), and those groups survive the worker bake. But Three's group
// order is NOT the SL face-numbering order. SL numbers faces per the LLVolume face list
// (https://wiki.secondlife.com/wiki/Face): clean box = top(+Z)0, -Y1, +X2, +Y3, -X4, bottom(-Z)5;
// cylinder = top(+Z)0, outside1, bottom(-Z)2. Composed with our axis bake (slToThree(x,y,z)=(x,z,-y)
// → Three +Y=SL +Z, +Z=SL -Y), the group→SLface arrays below result. Naming a wrong number here puts
// textures on the wrong sides, so these are frozen + unit-tested + live-verified.
//
// Only a true square box and a plain cylinder are mappable. Prism's 3 sides collapse into ONE Three
// group; triangle/half profiles render as a box (wrong face set); hollow/cut renumbers SL faces.
// All of those return null → caller keeps the dominant-face MVP.

export const BOX_FACE_MAP = [2, 4, 0, 5, 1, 3]  // group materialIndex (0..5) → SL face index
export const CYL_FACE_MAP = [1, 0, 2]            // group materialIndex (0..2) → SL face index

export function primFaceMap(shape) {
	if (!shape) return null
	// Hollow or any path/profile cut changes the SL face count + numbering → not mappable.
	// Decoder stores these as raw U16 where 0 = uncut/no-hollow (true for both raw and normalized).
	if (shape.profileHollow || shape.pathBegin || shape.pathEnd || shape.profileBegin || shape.profileEnd) {
		return null
	}
	// If neither curve field is present the shape is underspecified → not mappable.
	if (!('pathCurve' in shape) && !('profileCurve' in shape)) return null
	const pc = shape.pathCurve ?? 16
	const pf = (shape.profileCurve ?? 1) & 0x0F
	if (pc === 16 && pf === 1) return BOX_FACE_MAP   // square box: 6 faces, 1:1 with groups
	if (pc === 16 && pf === 0) return CYL_FACE_MAP   // cylinder: side/top/bottom
	return null                                       // prism, triangle, sphere, torus, etc → fallback
}

// Resolve a geometry group's materialIndex to its SL face index. Identity when no map (mesh path,
// where group index already equals SL face) or when the index is outside the map.
export function slFaceForGroup(faceMap, groupIndex) {
	if (!faceMap) return groupIndex
	const f = faceMap[groupIndex]
	return f === undefined ? groupIndex : f
}

// SL "Blank" texture is the default no-image fill — treat as "no real texture".
const SL_BLANK = '5748decc-f629-461c-9a36-a35a221fe21f'
const ZERO_UUID = '00000000-0000-0000-0000-000000000000'
function isRealTexUuid(u) {
	return !!u && u !== ZERO_UUID && u !== SL_BLANK
}

// True when the prim's faces carry ≥2 distinct real textures OR ≥2 distinct tints. This is the
// gate for entering the (more expensive) per-face multi-material path; uniform prims stay on the
// cheap single-material path.
export function primFacesDiffer(obj) {
	if (!obj) return false
	const texSet = new Set()
	if (isRealTexUuid(obj.defaultTexture)) texSet.add(obj.defaultTexture)
	if (Array.isArray(obj.faceTextures)) for (const f of obj.faceTextures) if (isRealTexUuid(f)) texSet.add(f)
	if (texSet.size >= 2) return true
	const colKey = (c) => (Array.isArray(c) ? c.map((v) => Math.round(v * 255)).join(',') : null)
	const colSet = new Set()
	const dk = colKey(obj.defaultColor)
	if (dk) colSet.add(dk)
	if (Array.isArray(obj.faceColors)) for (const c of obj.faceColors) { const k = colKey(c); if (k) colSet.add(k) }
	return colSet.size >= 2
}
