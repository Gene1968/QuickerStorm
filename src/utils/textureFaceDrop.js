// src/utils/textureFaceDrop.js — pure helpers for WorldCanvas's texture-onto-a-face drop path
// (Package 5). Sibling to rezzableAnchor.js: same file (WorldCanvas.vue onDrop) needs a second,
// unrelated pure decision — "can/should this TEXTURE item be applied to the hit face?" — so it gets
// its own pure + unit-tested module rather than growing rezzableAnchor's OBJECT-rez-only contract.
//
// FS reference: lltooldraganddrop.cpp dad3dTextureObject :2867 → dad3dApplyToObject :2729-2864.
import { primFaceMap } from '@/lib/primFaceMap.js'
import { PERM_MODIFY } from '@/utils/objectPermissions.js'

const ZERO_UUID = '00000000-0000-0000-0000-000000000000'

// Every per-face TextureEntry override array the client decodes (server/lib/lludp-codec.ts
// TEFields) — used to derive a face-count LOWER BOUND for shapes primFaceMap can't classify.
const FACE_OVERRIDE_KEYS = [
	'faceTextures', 'faceColors', 'faceRepeats', 'faceOffset', 'faceRotation',
	'faceBump', 'faceShiny', 'faceFullbright', 'faceMediaFlags', 'faceTexGen',
	'faceGlow', 'faceMaterialId',
]

/**
 * How many real TE faces does this object have? Must be EXACT (not a guess) — OBJECT_SET_TEXTURE
 * is a whole-TE replace (OpenSim SceneObjectPart.cs:5118), so sending fewer faces than the object
 * really has would silently blank out the missing ones.
 *   - Plain box/cylinder prims (primFaceMap.js): the shape alone gives an exact count (6 or 3),
 *     independent of whatever overrides happen to be recorded — a brand-new untextured cube still
 *     has 6 real faces.
 *   - Meshes (and any shape primFaceMap can't classify — prism/sphere/torus/hollow/cut prims):
 *     no shape-derived count exists client-side. Best-effort: 1 + the highest face index any
 *     per-face TE array actually overrides. A mesh with NO per-face overrides at all recorded
 *     (rare — most mesh content has ≥1 face override) can't be counted this way → returns 0, and
 *     the caller must refuse rather than clobber (docs/FEATURE-GAPS.md 2026-07-13).
 * @returns {number} exact face count, or 0 when it can't be determined safely
 */
export function faceCountFor(obj) {
	if (!obj) return 0
	const map = primFaceMap(obj.shape)
	if (map) return map.length
	if (!obj.meshId) return 0
	let max = -1
	for (const key of FACE_OVERRIDE_KEYS) {
		const arr = obj[key]
		if (!Array.isArray(arr)) continue
		for (let i = 0; i < arr.length; i++) if (arr[i] != null) max = Math.max(max, i)
	}
	return max + 1
}

/**
 * Compose the FULL per-face table (shared/protocol.js C.OBJECT_SET_TEXTURE `faces` shape) for
 * `numFaces` faces, resolving each field from the face override if present else the object's
 * default — a whole-TE replace must round-trip every currently-effective value, not just the one
 * being changed. Pure; the caller swaps textureId on the target face(s) afterward.
 */
export function composeFaceTable(obj, numFaces) {
	const faces = []
	for (let i = 0; i < numFaces; i++) {
		const rep = obj.faceRepeats?.[i] ?? obj.defaultRepeats
		const off = obj.faceOffset?.[i] ?? obj.defaultOffset
		faces.push({
			textureId:  obj.faceTextures?.[i] ?? obj.defaultTexture,
			color:      obj.faceColors?.[i] ?? obj.defaultColor,
			repeatU:    rep?.[0],
			repeatV:    rep?.[1],
			offsetU:    off?.[0],
			offsetV:    off?.[1],
			rotation:   obj.faceRotation?.[i] ?? obj.defaultRotation,
			bump:       obj.faceBump?.[i] ?? obj.defaultBump,
			shiny:      obj.faceShiny?.[i] ?? obj.defaultShiny,
			fullbright: obj.faceFullbright?.[i] ?? obj.defaultFullbright,
			mediaFlags: obj.faceMediaFlags?.[i] ?? obj.defaultMediaFlags,
			texGen:     obj.faceTexGen?.[i] ?? obj.defaultTexGen,
			glow:       obj.faceGlow?.[i] ?? obj.defaultGlow,
			materialId: obj.faceMaterialId?.[i] ?? obj.defaultMaterialId,
		})
	}
	return faces
}

/**
 * Client-side prediction of OpenSim's CanEditObject Modify gate (PermissionsModule.cs:1354),
 * mirroring FS dad3dApplyToObject's `!obj->permModify() → ACCEPT_NO_LOCKED` (lltooldraganddrop.cpp
 * :2755-2758). Unknown perms (ObjectProperties not yet arrived) → allow; the sim stays authoritative
 * and refuses silently if we're wrong — same "unknown → enabled" convention as canTakeObject.
 * @returns {boolean}
 */
export function canModifyForTexture(obj, agentId) {
	if (!obj?.ownerId || obj.ownerId === ZERO_UUID) return true
	const isOwner = !!agentId && obj.ownerId.toLowerCase() === agentId.toLowerCase()
	if (isOwner) return obj.ownerMask == null ? true : (obj.ownerMask & PERM_MODIFY) !== 0
	return obj.everyoneMask == null ? true : (obj.everyoneMask & PERM_MODIFY) !== 0
}
