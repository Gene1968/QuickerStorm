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
 * Build a sculpt mesh from decoded RGB(A) pixels. `detail` = base grid resolution (verts per side
 * before type-specific wrap rows/cols are added). 32 matches a typical viewer sculpt LOD; 33×33-ish
 * vertex counts stay well under the Uint16 index limit.
 */
export function sculptToSubmesh(
	px: Uint8Array | number[], width: number, height: number, channels: number,
	sculptTypeRaw: number, detail = 32,
): SculptSubmesh {
	const type = sculptTypeRaw & TYPE_MASK
	const cols = Math.max(2, detail)
	const rows = Math.max(2, detail)

	// Sample the source image into a grid of local-space vertices.
	const grid: Vec3[][] = []
	for (let y = 0; y < rows; y++) {
		const sy = Math.round((y / (rows - 1)) * (height - 1))
		const row: Vec3[] = []
		for (let x = 0; x < cols; x++) {
			const sx = Math.round((x / (cols - 1)) * (width - 1))
			row.push(sampleVertex(px, width, height, channels, sx, sy))
		}
		grid.push(row)
	}

	// Non-plane sculpts wrap horizontally: duplicate column 0 as a trailing column so the seam closes.
	if (type !== PLANE) for (const row of grid) row.push([...row[0]])

	// Sphere: collapse the top and bottom rows each to a single pole point (the mid-column sample).
	if (type === SPHERE) {
		const across = grid[0].length
		const topPole = [...grid[0][across >> 1]] as Vec3
		const botPole = [...grid[rows - 1][across >> 1]] as Vec3
		for (let x = 0; x < across; x++) { grid[0][x] = [...topPole]; grid[rows - 1][x] = [...botPole] }
	}

	// Torus wraps vertically too: append row 0 as a trailing row.
	if (type === TORUS) grid.push(grid[0].map(c => [...c] as Vec3))

	const down = grid.length
	const across = grid[0].length
	const vCount = down * across
	const positions = new Float32Array(vCount * 3)
	const uvs = new Float32Array(vCount * 2)
	for (let y = 0; y < down; y++) {
		for (let x = 0; x < across; x++) {
			const vi = y * across + x
			const c = grid[y][x]
			positions[vi * 3] = c[0]; positions[vi * 3 + 1] = c[1]; positions[vi * 3 + 2] = c[2]
			uvs[vi * 2] = x / (across - 1); uvs[vi * 2 + 1] = y / (down - 1)
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
