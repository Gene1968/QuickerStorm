// server/lib/meshDecode.ts — decode SL/OpenSim mesh assets (application/vnd.ll.mesh).
// Layout: an LLSD-binary header map { <lod>: {offset,size}, … } followed by data blocks. Each LOD
// block is zlib-deflated LLSD-binary: an array of submeshes (Position/Normal/TexCoord0 as U16-
// quantized blobs un-quantized via *Domain, TriangleList as U16 indices). Offsets in the header are
// relative to headerSize (the byte just past the header). Verified against a captured real asset.
import { parseLLSDBinary } from './llsd'
import { inflateSync, inflateRawSync } from 'zlib'

export interface LodRef { offset: number; size: number }
export interface MeshHeader {
	headerSize: number
	lods: { high?: LodRef; medium?: LodRef; low?: LodRef; lowest?: LodRef }
	skin?: LodRef   // rig block (present on rigged/skinned meshes) — sibling header key, same {offset,size} shape
}
export interface Submesh {
	positions: Float32Array
	normals: Float32Array
	uvs: Float32Array
	indices: Uint16Array
	jointIndices?: Uint8Array    // rigged only: 4 per vertex (index into skin.jointNames), 0-padded
	jointWeights?: Float32Array   // rigged only: 4 per vertex, renormalized to sum 1, 0-padded
}
// Decoded mesh "skin" (rig) block. For the static bind-pose milestone (AV-1) only bindShapeMatrix is
// consumed by the client; jointNames / inverseBindMatrix / pelvisOffset are captured for later skeletal
// animation. Field names + row-major 4×4 layout mirror FS LLMeshSkinInfo::fromLLSD (llmodel.cpp:1671).
export interface SkinInfo {
	jointNames: string[]
	bindShapeMatrix: number[]        // 16 floats, row-major (SL/FS convention: v' = v · M)
	inverseBindMatrix: number[][]    // per-joint 16-float matrices (unused until animated posing)
	altInverseBindMatrix: number[][] // per-joint override matrices; translation = the mesh's desired LOCAL
	//                                  joint position (7·D joint-position overrides, FS llvoavatar.cpp:7756)
	pelvisOffset: number
	lockScaleIfJointPosition: boolean
}

/** Parse the mesh asset header. Offsets in the header are relative to headerSize (end of header). */
export function parseMeshHeader(buf: Buffer): MeshHeader {
	const { value, end } = parseLLSDBinary(buf, 0)
	const m = (value && typeof value === 'object') ? value as Record<string, any> : {}
	const ref = (k: string): LodRef | undefined => {
		const r = m[k]
		return r && typeof r === 'object' && typeof r.offset === 'number' && typeof r.size === 'number'
			? { offset: r.offset, size: r.size } : undefined
	}
	return {
		headerSize: end,
		lods: { high: ref('high_lod'), medium: ref('medium_lod'), low: ref('low_lod'), lowest: ref('lowest_lod') },
		skin: ref('skin'),
	}
}

const IDENTITY16 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

/**
 * Decode the mesh "skin" block: a zlib-deflated LLSD-binary MAP (not a submesh array). Carries the rig
 * data that places a rigged mesh onto the avatar. At rest pose the per-joint skinning blend collapses
 * to identity, so world_pos ≈ v_local · bind_shape_matrix (FS llvovolume.cpp:5319-5341) — the client
 * needs only bindShapeMatrix for the static bind-pose milestone. Row-major 4×4 fill matches FS
 * LLMeshSkinInfo::fromLLSD (llmodel.cpp:1707: mMatrix[j][k] = arr[j*4+k]). Returns null if absent/bad.
 */
export function decodeSkinBlock(buf: Buffer, headerSize: number, ref: LodRef): SkinInfo | null {
	let inflated: Buffer
	try {
		inflated = inflateLod(buf.subarray(headerSize + ref.offset, headerSize + ref.offset + ref.size))
	} catch { return null }
	const { value } = parseLLSDBinary(inflated, 0)
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null
	const m = value as Record<string, any>
	const mat16 = (a: any): number[] | null => {
		if (!Array.isArray(a) || a.length !== 16) return null
		const nums = a.map(Number)
		return nums.every(Number.isFinite) ? nums : null
	}
	const jointNames = Array.isArray(m.joint_names) ? m.joint_names.map((s: any) => String(s)) : []
	const bindShapeMatrix = mat16(m.bind_shape_matrix) ?? IDENTITY16.slice()
	const inverseBindMatrix = Array.isArray(m.inverse_bind_matrix)
		? m.inverse_bind_matrix.map(mat16).filter((r: number[] | null): r is number[] => r !== null)
		: []
	// alt_inverse_bind_matrix (optional): despite the name, FS reads each matrix's translation column as the
	// mesh's desired LOCAL joint position and applies it as a joint-position override (llvoavatar.cpp:7756 →
	// LLJoint::addAttachmentPosOverride). One per joint when present; drives mesh-body proportions (7·D).
	const altInverseBindMatrix = Array.isArray(m.alt_inverse_bind_matrix)
		? m.alt_inverse_bind_matrix.map(mat16).filter((r: number[] | null): r is number[] => r !== null)
		: []
	const pelvisOffset = Number.isFinite(Number(m.pelvis_offset)) ? Number(m.pelvis_offset) : 0
	return { jointNames, bindShapeMatrix, inverseBindMatrix, altInverseBindMatrix, pelvisOffset, lockScaleIfJointPosition: m.lock_scale_if_joint_position === true }
}

/**
 * Choose the LOD ref for the wanted level (0=high…3=lowest), falling back to the nearest
 * available level when a mesh omits one (some assets ship only high). Returns the chosen
 * level index alongside the ref so the caller can report what was actually served.
 */
export function pickLodRef(
	lods: { high?: LodRef; medium?: LodRef; low?: LodRef; lowest?: LodRef },
	want: number,
): { lod: number; ref: LodRef } | null {
	const order = [lods.high, lods.medium, lods.low, lods.lowest]
	const clamped = Math.max(0, Math.min(3, want | 0))
	// Search outward from the wanted level. On a tie (exact level missing) prefer the COARSER neighbour
	// (higher index) over the finer one — cheaper to render and matches Firestorm's fallback to the
	// simplest available LOD. At d=0, lo===hi===clamped (the exact level), so it's returned first.
	for (let d = 0; d < 4; d++) {
		const lo = clamped - d, hi = clamped + d
		if (hi <= 3 && order[hi]) return { lod: hi, ref: order[hi]! }
		if (lo >= 0 && order[lo]) return { lod: lo, ref: order[lo]! }
	}
	return null
}

function inflateLod(slice: Buffer): Buffer {
	try { return inflateSync(slice) } catch { return inflateRawSync(slice) }
}

// Un-quantize a U16 (0..65535) to [lo, hi].
const dequant = (u: number, lo: number, hi: number) => lo + (u / 65535) * (hi - lo)

/** Decode one LOD block into submesh geometry arrays (positions/normals/uvs un-quantized). */
export function decodeMeshLOD(buf: Buffer, headerSize: number, lod: LodRef): Submesh[] {
	const slice = buf.subarray(headerSize + lod.offset, headerSize + lod.offset + lod.size)
	const inflated = inflateLod(slice)
	const { value } = parseLLSDBinary(inflated, 0)
	const arr = Array.isArray(value) ? value : []
	const out: Submesh[] = []
	for (const sm of arr) {
		if (!sm || typeof sm !== 'object' || sm.NoGeometry) continue
		const posBuf = sm.Position, normBuf = sm.Normal, uvBuf = sm.TexCoord0, idxBuf = sm.TriangleList
		if (!Buffer.isBuffer(posBuf) || !Buffer.isBuffer(idxBuf)) continue
		// Sanitize domains: a non-finite Min/Max would make every un-quantized coord NaN → NaN
		// BufferGeometry ("Computed radius is NaN"). Fall back to a unit cube / 0..1 UV.
		const fin = (a: any, def: number[]) => (Array.isArray(a) && a.length >= def.length && a.every(Number.isFinite)) ? a : def
		const pd = { Min: fin(sm.PositionDomain?.Min, [-0.5, -0.5, -0.5]), Max: fin(sm.PositionDomain?.Max, [0.5, 0.5, 0.5]) }
		const tcd = { Min: fin(sm.TexCoord0Domain?.Min, [0, 0]), Max: fin(sm.TexCoord0Domain?.Max, [1, 1]) }
		const vCount = Math.floor(posBuf.length / 6)
		const positions = new Float32Array(vCount * 3)
		const normals = new Float32Array(vCount * 3)
		const uvs = new Float32Array(vCount * 2)
		for (let v = 0; v < vCount; v++) {
			positions[v * 3 + 0] = dequant(posBuf.readUInt16LE(v * 6 + 0), pd.Min[0], pd.Max[0])
			positions[v * 3 + 1] = dequant(posBuf.readUInt16LE(v * 6 + 2), pd.Min[1], pd.Max[1])
			positions[v * 3 + 2] = dequant(posBuf.readUInt16LE(v * 6 + 4), pd.Min[2], pd.Max[2])
			if (Buffer.isBuffer(normBuf) && normBuf.length >= v * 6 + 6) {
				normals[v * 3 + 0] = dequant(normBuf.readUInt16LE(v * 6 + 0), -1, 1)
				normals[v * 3 + 1] = dequant(normBuf.readUInt16LE(v * 6 + 2), -1, 1)
				normals[v * 3 + 2] = dequant(normBuf.readUInt16LE(v * 6 + 4), -1, 1)
			}
			if (Buffer.isBuffer(uvBuf) && uvBuf.length >= v * 4 + 4) {
				uvs[v * 2 + 0] = dequant(uvBuf.readUInt16LE(v * 4 + 0), tcd.Min[0], tcd.Max[0])
				uvs[v * 2 + 1] = dequant(uvBuf.readUInt16LE(v * 4 + 2), tcd.Min[1], tcd.Max[1])
			}
		}
		const triCount = Math.floor(idxBuf.length / 2)
		const indices = new Uint16Array(triCount)
		for (let i = 0; i < triCount; i++) indices[i] = idxBuf.readUInt16LE(i * 2)
		// Rigged meshes carry a per-vertex "Weights" blob (parallel to Position). Format (FS
		// llmodel.cpp:1050-1101): each vertex is up to 4 influences of {u8 boneIdx, u16 weightLE}, and a
		// 0xFF terminator byte follows ONLY when the vertex has < 4 influences (exactly 4 → no terminator).
		let jointIndices: Uint8Array | undefined, jointWeights: Float32Array | undefined
		const wBuf = sm.Weights
		if (Buffer.isBuffer(wBuf)) {
			jointIndices = new Uint8Array(vCount * 4)
			jointWeights = new Float32Array(vCount * 4)
			let p = 0
			for (let v = 0; v < vCount; v++) {
				let sum = 0
				for (let i = 0; i < 4; i++) {
					if (p >= wBuf.length) break
					const idx = wBuf[p]; p++
					if (idx === 0xFF) break                 // terminator → this vertex has < 4 influences
					if (p + 2 > wBuf.length) break
					const w = wBuf.readUInt16LE(p); p += 2
					jointIndices[v * 4 + i] = idx
					jointWeights[v * 4 + i] = w
					sum += w
				}
				if (sum > 0) for (let k = 0; k < 4; k++) jointWeights[v * 4 + k] /= sum   // renormalize to 1
			}
		}
		out.push({ positions, normals, uvs, indices, jointIndices, jointWeights })
	}
	return out
}
