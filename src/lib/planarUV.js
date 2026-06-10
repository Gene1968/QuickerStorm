// src/lib/planarUV.js — pure planar-texgen UV math (SL TEX_GEN_PLANAR).
//
// WHY: when a face's TexGen is planar (TE MediaFlags bits 1:2 → defaultTexGen/faceTexGen === 1),
// SL viewers IGNORE the authored mesh UVs and regenerate the texture coordinate per vertex by
// projecting its position onto a plane derived from the vertex normal's dominant axis. Rendering
// such faces through the authored UVs (often a degenerate atlas) produces stripes/moire. Ported
// 1:1 from Firestorm llface.cpp planarProjection() — do not "simplify" the constants; the
// 2×-0.5/+1 shifts are what make our planar scale/phase match other viewers.
//
// Inputs are SL/volume-space coordinates with the prim scale already applied to the position
// (FS: volume_position.mul(scale)) — which is exactly what our baked Three geometry holds, after
// the axis swap back (see planarUVFromThree).

export function planarUV(px, py, pz, nx, ny, nz) {
	// Normalize: the dominant-axis test below assumes a unit normal.
	const len = Math.hypot(nx, ny, nz)
	if (len > 0) { nx /= len; ny /= len; nz /= len }
	// Binormal from the normal's dominant axis (FS llface.cpp:96-120).
	let bx, by, bz
	if (nx >= 0.5 || nx <= -0.5) {
		bx = 0; by = nx < 0 ? -1 : 1; bz = 0
	} else {
		bx = ny > 0 ? -1 : 1; by = 0; bz = 0
	}
	// tangent = binormal × normal
	const tx = by * nz - bz * ny
	const ty = bz * nx - bx * nz
	const tz = bx * ny - by * nx
	const bdot = bx * px + by * py + bz * pz
	const tdot = tx * px + ty * py + tz * pz
	// u = 1 + (B·P)·2 − 0.5 ; v = −((T·P)·2 − 0.5)   (FS llface.cpp:124-125)
	return [1 + (bdot * 2 - 0.5), -(tdot * 2 - 0.5)]
}

// Same, but taking our baked Three-space position/normal. The bake maps SL (x,y,z) →
// Three (x, z, −y), so the inverse is SL = (tx, −tz, ty) for positions and normals alike.
export function planarUVFromThree(px, py, pz, nx, ny, nz) {
	return planarUV(px, -pz, py, nx, -nz, ny)
}
