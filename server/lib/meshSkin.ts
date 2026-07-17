// server/lib/meshSkin.ts — static rest-pose linear-blend skinning for rigged mesh (AV-1).
//
// Real viewers place a rigged mesh by skinning its vertices onto the avatar skeleton. At REST pose
// (no active animation) the per-vertex transform is (FS llvovolume.cpp:5319-5341 + llskinningutil.cpp
// initSkinningMatrixPalette), in ROW-VECTOR convention (v' = v · M, LLMatrix4a):
//
//   skinned = v · bind_shape · Σ_k weight_k · (inverse_bind_matrix[k] · jointRestWorld[k])
//
// where jointRestWorld[k] is joint k's WORLD matrix in the default skeleton rest pose. Because the SL
// default skeleton has zero rotation everywhere at rest (avatar_skeleton.xml), jointRestWorld is a pure
// translation (see avatarSkeleton.ts). The inverse_bind_matrix retargets the mesh's own bind skeleton
// onto the default one, so this works even when bind_shape itself is a tiny (near-singular) scale — the
// case that makes "bind_shape alone" collapse a mesh body to a point (why AV-1 needs real skinning).
//
// We bake the rest-posed positions SERVER-SIDE and ship static geometry; no per-frame skinning, no
// animation yet. All matrices here are row-major number[16] (M[row*4+col]).
import { jointRestWorld } from './avatarSkeleton'
import type { SkinInfo } from './meshDecode'

const IDENTITY16 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

/** Row-major 4×4 product C = A·B (row-vector convention: v·(A·B) = (v·A)·B). */
function matMul(a: number[], b: number[]): number[] {
	const c = new Array(16)
	for (let i = 0; i < 4; i++) {
		for (let j = 0; j < 4; j++) {
			c[i * 4 + j] = a[i * 4] * b[j] + a[i * 4 + 1] * b[4 + j] + a[i * 4 + 2] * b[8 + j] + a[i * 4 + 3] * b[12 + j]
		}
	}
	return c
}

export interface SkinnableSubmesh {
	positions: Float32Array
	normals: Float32Array
	uvs: Float32Array
	indices: Uint16Array
	jointIndices?: Uint8Array   // 4 per vertex (index into skin.jointNames), 0-padded
	jointWeights?: Float32Array  // 4 per vertex, sum ~1 (renormalized), 0-padded
}

/**
 * Build the per-joint skinning palette (already pre-multiplied by bind_shape) for a mesh's joint list:
 *   BSpalette[k] = bind_shape · inverse_bind_matrix[k] · jointRestWorld[k]
 * A joint whose name isn't in the default skeleton, or that lacks an inverse-bind matrix, falls back to
 * bind_shape alone (identity retarget) so a stray joint can't NaN the whole mesh.
 */
function buildPalette(skin: SkinInfo): number[][] {
	const bind = (skin.bindShapeMatrix && skin.bindShapeMatrix.length === 16) ? skin.bindShapeMatrix : IDENTITY16
	return skin.jointNames.map((name, k) => {
		const invBind = skin.inverseBindMatrix[k]
		const restWorld = jointRestWorld(name)   // bone OR collision volume (fitted mesh); full 4×4
		if (!invBind || invBind.length !== 16 || !restWorld) return bind.slice()
		return matMul(bind, matMul(invBind, restWorld))
	})
}

/**
 * Skin one submesh into rest-pose positions/normals (in SL avatar space). Returns NEW typed arrays; the
 * caller ships these as the submesh geometry. Vertices with no weight data fall back to v·bind_shape so
 * nothing vanishes. Requires jointIndices/jointWeights to be present (from decodeMeshLOD).
 */
export function skinSubmesh(sm: SkinnableSubmesh, palette: number[][], bind: number[]): { positions: Float32Array; normals: Float32Array } {
	const vCount = sm.positions.length / 3
	const outP = new Float32Array(sm.positions.length)
	const outN = new Float32Array(sm.normals.length)
	const ji = sm.jointIndices, jw = sm.jointWeights
	// Zero-weight vertex → 100% joint 0 (FS llvolume.cpp:2600 fallback), not bind-only, so it lands ON
	// the body rather than collapsing at bind_shape's tiny scale.
	const fallback = palette.length ? palette[0] : bind
	const acc = new Array(16)
	for (let v = 0; v < vCount; v++) {
		const px = sm.positions[v * 3], py = sm.positions[v * 3 + 1], pz = sm.positions[v * 3 + 2]
		const nx = sm.normals[v * 3], ny = sm.normals[v * 3 + 1], nz = sm.normals[v * 3 + 2]
		// Accumulate the weighted skin matrix for this vertex (linear blend).
		let wSum = 0
		if (ji && jw) {
			for (let t = 0; t < 16; t++) acc[t] = 0
			for (let i = 0; i < 4; i++) {
				const w = jw[v * 4 + i]
				if (w <= 0) continue
				const m = palette[ji[v * 4 + i]] || bind
				for (let t = 0; t < 16; t++) acc[t] += w * m[t]
				wSum += w
			}
		}
		const M = wSum > 1e-6 ? acc : fallback   // no weights → 100% joint 0 (FS parity), never vanish
		outP[v * 3]     = px * M[0] + py * M[4] + pz * M[8]  + M[12]
		outP[v * 3 + 1] = px * M[1] + py * M[5] + pz * M[9]  + M[13]
		outP[v * 3 + 2] = px * M[2] + py * M[6] + pz * M[10] + M[14]
		// Normal: rotation/scale part only (no translation), then normalize.
		let ox = nx * M[0] + ny * M[4] + nz * M[8]
		let oy = nx * M[1] + ny * M[5] + nz * M[9]
		let oz = nx * M[2] + ny * M[6] + nz * M[10]
		const len = Math.hypot(ox, oy, oz) || 1
		outN[v * 3] = ox / len; outN[v * 3 + 1] = oy / len; outN[v * 3 + 2] = oz / len
	}
	return { positions: outP, normals: outN }
}

/** Skin every submesh of a rigged mesh in place-ish (returns new arrays). Palette built once per mesh. */
export function skinSubmeshes(subs: SkinnableSubmesh[], skin: SkinInfo): SkinnableSubmesh[] {
	const bind = (skin.bindShapeMatrix && skin.bindShapeMatrix.length === 16) ? skin.bindShapeMatrix : IDENTITY16
	const palette = buildPalette(skin)
	return subs.map(sm => {
		const { positions, normals } = skinSubmesh(sm, palette, bind)
		return { ...sm, positions, normals }
	})
}
