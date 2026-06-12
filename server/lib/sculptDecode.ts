// server/lib/sculptDecode.ts — decode a legacy sculpt map (a J2C texture, already decoded to raw
// RGB pixels) into a triangle mesh, per the libomv/PrimMesher SculptMesh algorithm.
//
// A sculpt map encodes a surface as an image: each pixel's (R,G,B) is a 3D point in the prim's
// local space, mapped byte/255 → [-0.5, 0.5]. The grid of points is stitched into quads. The
// sculpt TYPE controls edge wrapping:
//   1 sphere   — wrap columns + collapse top/bottom rows to single poles
//   2 torus    — wrap columns AND rows
//   3 plane    — open grid, no wrap
//   4 cylinder — wrap columns only
// (type 5 = mesh, handled by the separate mesh pipeline, not here.)
//
// Output matches meshDecode's Submesh so the client builds it through the same BufferGeometry path.
// Positions are in SL local space; the client applies the SL→Three axis swap + prim scale.

const TYPE_MASK = 0x07
const SPHERE = 1, TORUS = 2, PLANE = 3 /* , CYLINDER = 4 */

export interface SculptSubmesh {
	positions: Float32Array
	normals: Float32Array
	uvs: Float32Array
	indices: Uint16Array
}

type Vec3 = [number, number, number]

// Nearest-neighbour sample of the source image at grid fraction → local-space vertex [-0.5,0.5].
function sampleVertex(px: Uint8Array | number[], w: number, h: number, ch: number, sx: number, sy: number): Vec3 {
	const cx = Math.min(w - 1, Math.max(0, sx))
	const cy = Math.min(h - 1, Math.max(0, sy))
	const i = (cy * w + cx) * ch
	const r = px[i]
	const g = ch > 1 ? px[i + 1] : r
	const b = ch > 2 ? px[i + 2] : r
	return [r / 255 - 0.5, g / 255 - 0.5, b / 255 - 0.5]
}

function computeNormals(positions: Float32Array, indices: Uint16Array): Float32Array {
	const n = new Float32Array(positions.length)
	for (let t = 0; t < indices.length; t += 3) {
		const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3
		const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2]
		const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2]
		const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
		for (const p of [a, b, c]) { n[p] += nx; n[p + 1] += ny; n[p + 2] += nz }
	}
	for (let i = 0; i < n.length; i += 3) {
		const len = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1
		n[i] /= len; n[i + 1] /= len; n[i + 2] /= len
	}
	return n
}

/**
 * Aspect-aware sculpt grid resolution — verbatim port of FS sculpt_calc_mesh_resolution
 * (llvolume.cpp:3170). Returns quads (sides) per axis: sidesT across (profile/width),
 * sidesS down (path/height). The mesh aspect tracks the MAP aspect within a vertex budget of
 * min(detail², width×height/4) — an oblong 8×512 billboard-forest map gets a 4×256-side grid
 * (NOT 32×32; a fixed square grid skips rows and mangles the shape).
 */
export function sculptGridResolution(width: number, height: number, detail: number): { sidesS: number; sidesT: number } {
	const maxLod = detail * detail
	const maxMap = Math.floor((width * height) / 4)
	const vertices = maxMap > 0 ? Math.min(maxLod, maxMap) : maxLod
	const ratio = width > 0 && height > 0 ? width / height : 1
	let s = Math.floor(Math.sqrt(vertices / ratio))
	s = Math.max(s, 4)
	let t = Math.floor(vertices / s)
	t = Math.max(t, 4)
	s = Math.floor(vertices / t)
	return { sidesS: s, sidesT: t }
}

/**
 * Build a sculpt mesh from decoded RGB(A) pixels, mirroring Firestorm's
 * LLVolume::sculpt → sculptGenerateMapVertices (llvolume.cpp:3050/3205) EXACTLY:
 *   grid = (sidesS+1)×(sidesT+1) vertices (genNGon emits sides+1 points spanning 0..1 inclusive),
 *   map sampled at texel floor(k/sides × dim) — for canonical power-of-two maps that is EVEN
 *   texels only. Creators rely on this: odd texels are never read by SL viewers at max sculpt LOD
 *   and may hold garbage; sampling them (as we previously did via round(k/(verts-1) × (dim-1)))
 *   produced stray geometry. UV spacing is k/sides, which phase-aligns grid-multiple texture
 *   repeats (live-verified palm forest: 8×512 map → 4×256-side grid; RepeatU=4/RepeatV=-256 land
 *   exactly one full texture per quad — by authorial design).
 * `detail` = max LOD sides (32 = max viewer sculpt LOD).
 */
export function sculptToSubmesh(
	px: Uint8Array | number[], width: number, height: number, channels: number,
	sculptTypeRaw: number, detail = 32,
): SculptSubmesh {
	const type = sculptTypeRaw & TYPE_MASK
	const invert = (sculptTypeRaw & 0x40) !== 0   // LL_SCULPT_FLAG_INVERT
	const mirror = (sculptTypeRaw & 0x80) !== 0   // LL_SCULPT_FLAG_MIRROR
	const reverseHorizontal = invert ? !mirror : mirror   // XOR, llvolume.cpp:3055
	const { sidesS, sidesT } = sculptGridResolution(width, height, Math.max(2, detail))
	const down = sidesS + 1
	const across = sidesT + 1

	const vCount = down * across
	const positions = new Float32Array(vCount * 3)
	const uvs = new Float32Array(vCount * 2)
	for (let j = 0; j <= sidesS; j++) {
		let syFS = Math.floor((j / sidesS) * height)
		if (syFS >= height) syFS = type === TORUS ? 0 : height - 1   // end row: wrap (torus) / clamp
		// WHY flip: FS samples LLImageRaw, whose scanlines are stored BOTTOM-UP (llimagej2coj.cpp
		// copies decoded J2C rows in reverse). Our decoder yields top-down rows, so mirror the row
		// index — without this the row pairing is reversed, which flips the texture vertically on
		// the surface (upside-down fronds) AND reverses triangle winding (inside-out trunks).
		const sy = height - 1 - syFS
		for (let k = 0; k <= sidesT; k++) {
			const rk = reverseHorizontal ? sidesT - k : k
			let sx = Math.floor((rk / sidesT) * width)
			if (sx >= width) sx = type === PLANE ? width - 1 : 0   // side seam: clamp (plane) / wrap
			if (type === SPHERE && (j === 0 || j === sidesS)) sx = width >> 1   // pole pinch rows
			const c = sampleVertex(px, width, height, channels, sx, sy)
			if (mirror) c[0] = -c[0]
			const vi = j * across + k
			positions[vi * 3] = c[0]; positions[vi * 3 + 1] = c[1]; positions[vi * 3 + 2] = c[2]
			uvs[vi * 2] = k / sidesT; uvs[vi * 2 + 1] = j / sidesS
		}
	}

	const indices = new Uint16Array((down - 1) * (across - 1) * 6)
	let o = 0
	for (let y = 1; y < down; y++) {
		for (let x = 1; x < across; x++) {
			const p4 = y * across + x, p3 = p4 - 1, p2 = p4 - across, p1 = p3 - across
			indices[o++] = p1; indices[o++] = p4; indices[o++] = p3
			indices[o++] = p1; indices[o++] = p2; indices[o++] = p4
		}
	}

	return { positions, normals: computeNormals(positions, indices), uvs, indices }
}
