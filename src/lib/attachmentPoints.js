// src/lib/attachmentPoints.js — SL avatar attachment-point model (bundle 7·B).
//
// Wire: ObjectUpdate's State byte carries the attachment-point id in its HIGH nibble; FS recovers it
// with a nibble swap (indra_constants.h ATTACHMENT_ID_FROM_STATE) and strips the ADD flag (bit that
// becomes 0x80 after the swap). Invalid/unknown ids fall back to 1=Chest (llvoavatar.cpp:8525).
//
// Placement: an attached root's pos/rot are relative to the attachment POINT frame = joint transform
// + the avatar_lad.xml <attachment_point> position/rotation offset (llviewerjointattachment.cpp
// setupDrawable — world = jointWorld · pointOffsetRot · objectLocal). Linkset children stay ordinary
// parent-relative under the root. HUD points (31-38, joint mScreen) are screen-space, never world.
//
// We mount points at the SL DEFAULT SKELETON REST POSITION of their joint (server AV-1 table,
// avatarSkeleton.ts JOINT_REST_WORLD — ground-origin SL frame) rather than live GLB bones: the
// jellydoll GLB uses UE-style bone names and the AV-1 contract already fixes worn rigged mesh at
// rest pose, so rest-pose points keep everything coherent. Attachments therefore don't follow the
// idle animation yet — FS-parity bone-following comes with the real animation system (bundle 7 later).
// Same fixed −RIG_FOOT_OFFSET ground contract as AV-1 (height-scaling refinement deferred).
import * as THREE from 'three'

// Joint rest positions (SL frame: x fwd, y left, z up; origin at avatar GROUND under mPelvis).
// Source: server/lib/avatarSkeleton.ts JOINT_REST_WORLD translations (generated from FS
// avatar_skeleton.xml) — keep in sync if the skeleton table regenerates.
const JOINT_REST = {
	mRoot:            [0, 0, 0],
	mPelvis:          [0, 0, 1.067],
	mTorso:           [0, 0, 1.151],
	mChest:           [-0.015, 0, 1.356],
	mNeck:            [-0.025, 0, 1.607],
	mHead:            [-0.025, 0, 1.683],
	mEyeLeft:         [0.073, 0.036, 1.762],
	mEyeRight:        [0.073, -0.036, 1.762],
	mCollarLeft:      [-0.036, 0.085, 1.521],
	mCollarRight:     [-0.036, -0.085, 1.521],
	mShoulderLeft:    [-0.036, 0.164, 1.521],
	mShoulderRight:   [-0.036, -0.164, 1.521],
	mElbowLeft:       [-0.036, 0.412, 1.521],
	mElbowRight:      [-0.036, -0.412, 1.521],
	mWristLeft:       [-0.036, 0.617, 1.521],
	mWristRight:      [-0.036, -0.617, 1.521],
	mHandRing1Left:   [-0.046, 0.716, 1.53],
	mHandRing1Right:  [-0.046, -0.716, 1.53],
	mHipLeft:         [0.034, 0.127, 1.026],
	mHipRight:        [0.034, -0.129, 1.026],
	mKneeLeft:        [0.033, 0.081, 0.535],
	mKneeRight:       [0.033, -0.08, 0.535],
	mFootLeft:        [0.116, 0.082, 0.006],
	mFootRight:       [0.116, -0.08, 0.006],
	mGroin:           [0.064, 0, 0.97],
	mTail1:           [-0.116, 0, 1.114],
	mTail6:           [-0.829, 0, 1.114],
	mWing4Left:       [-0.648, 0.63, 1.604],
	mWing4Right:      [-0.648, -0.63, 1.604],
	mFaceJaw:         [-0.001, 0, 1.713],
	mFaceEar1Left:    [0, 0.08, 1.73],
	mFaceEar1Right:   [0, -0.08, 1.73],
	mFaceEyeAltLeft:  [0.073, 0.036, 1.762],
	mFaceEyeAltRight: [0.073, -0.036, 1.762],
	mFaceTongueTip:   [0.081, 0, 1.686],
	mHindLimb4Left:   [-0.32, 0.08, 0.006],
	mHindLimb4Right:  [-0.32, -0.08, 0.006],
}

// avatar_lad.xml <attachment_point> table (FS, incl. Bento 41-55): id → [joint, px,py,pz, rx,ry,rz].
// Offsets are SL metres in the joint frame; rotations are SL-frame euler degrees (roll·pitch·yaw,
// fixed-axis X→Y→Z). Ids 31-38 are HUD (joint mScreen) — flagged, never world-rendered.
const POINTS = {
	1:  ['mChest',           0.15, 0, -0.1,   0, 90, 90],   // Chest
	2:  ['mHead',            0, 0, 0.15,      0, 0, 90],    // Skull
	3:  ['mCollarLeft',      0, 0, 0.08,      0, 0, 0],     // Left Shoulder
	4:  ['mCollarRight',     0, 0, 0.08,      0, 0, 0],     // Right Shoulder
	5:  ['mWristLeft',       0, 0.08, -0.02,  0, 0, 0],     // Left Hand
	6:  ['mWristRight',      0, -0.08, -0.02, 0, 0, 0],     // Right Hand
	7:  ['mFootLeft',        0, 0, 0,         0, 0, 0],     // Left Foot
	8:  ['mFootRight',       0, 0, 0,         0, 0, 0],     // Right Foot
	9:  ['mChest',           -0.15, 0, -0.1,  0, -90, 90],  // Spine
	10: ['mPelvis',          0, 0, -0.15,     0, 0, 0],     // Pelvis
	11: ['mHead',            0.12, 0, 0.001,  0, 0, 0],     // Mouth
	12: ['mHead',            0.12, 0, -0.04,  0, 0, 0],     // Chin
	13: ['mHead',            0.015, 0.08, 0.017,  0, 0, 0], // Left Ear
	14: ['mHead',            0.015, -0.08, 0.017, 0, 0, 0], // Right Ear
	15: ['mEyeLeft',         0, 0, 0,         0, 0, 0],     // Left Eyeball
	16: ['mEyeRight',        0, 0, 0,         0, 0, 0],     // Right Eyeball
	17: ['mHead',            0.1, 0, 0.05,    0, 0, 0],     // Nose
	18: ['mShoulderRight',   0.01, -0.13, 0.01,   0, 0, 0], // R Upper Arm
	19: ['mElbowRight',      0, -0.12, 0,     0, 0, 0],     // R Forearm
	20: ['mShoulderLeft',    0.01, 0.15, -0.01,   0, 0, 0], // L Upper Arm
	21: ['mElbowLeft',       0, 0.113, 0,     0, 0, 0],     // L Forearm
	22: ['mHipRight',        0, 0, 0,         0, 0, 0],     // Right Hip
	23: ['mHipRight',        -0.017, 0.041, -0.31,  0, 0, 0], // R Upper Leg
	24: ['mKneeRight',       -0.044, -0.007, -0.262, 0, 0, 0], // R Lower Leg
	25: ['mHipLeft',         0, 0, 0,         0, 0, 0],     // Left Hip
	26: ['mHipLeft',         -0.019, -0.034, -0.31,  0, 0, 0], // L Upper Leg
	27: ['mKneeLeft',        -0.044, -0.007, -0.261, 0, 0, 0], // L Lower Leg
	28: ['mPelvis',          0.092, 0, 0.088, 0, 0, 0],     // Stomach
	29: ['mTorso',           0.104, 0.082, 0.247,  0, 0, 0], // Left Pec
	30: ['mTorso',           0.104, -0.082, 0.247, 0, 0, 0], // Right Pec
	// 31-38 HUD (mScreen) — handled by HUD_MIN/MAX below, no world mount.
	39: ['mNeck',            0, 0, 0,         0, 0, 0],     // Neck
	40: ['mRoot',            0, 0, 0,         0, 0, 0],     // Avatar Center
	41: ['mHandRing1Left',   -0.006, 0.019, -0.002, 0, 0, 0], // Left Ring Finger
	42: ['mHandRing1Right',  -0.006, -0.019, -0.002, 0, 0, 0], // Right Ring Finger
	43: ['mTail1',           0, 0, 0,         0, 0, 0],     // Tail Base
	44: ['mTail6',           -0.025, 0, 0,    0, 0, 0],     // Tail Tip
	45: ['mWing4Left',       0, 0, 0,         0, 0, 0],     // Left Wing
	46: ['mWing4Right',      0, 0, 0,         0, 0, 0],     // Right Wing
	47: ['mFaceJaw',         0, 0, 0,         0, 0, 0],     // Jaw
	48: ['mFaceEar1Left',    0, 0, 0,         0, 0, 0],     // Alt Left Ear
	49: ['mFaceEar1Right',   0, 0, 0,         0, 0, 0],     // Alt Right Ear
	50: ['mFaceEyeAltLeft',  0, 0, 0,         0, 0, 0],     // Alt Left Eye
	51: ['mFaceEyeAltRight', 0, 0, 0,         0, 0, 0],     // Alt Right Eye
	52: ['mFaceTongueTip',   0, 0, 0,         0, 0, 0],     // Tongue
	53: ['mGroin',           0, 0, 0,         0, 0, 0],     // Groin
	54: ['mHindLimb4Left',   0, 0, 0,         0, 0, 0],     // Left Hind Foot
	55: ['mHindLimb4Right',  0, 0, 0,         0, 0, 0],     // Right Hind Foot
}

const HUD_MIN = 31, HUD_MAX = 38

/** Attachment-point id from the ObjectUpdate State byte (FS ATTACHMENT_ID_FROM_STATE nibble swap,
 *  ADD flag stripped). 0 = not an attachment / unknown. */
export function attachPointFromState(state) {
	if (!state) return 0
	const id = (((state & 0xf0) >> 4) | ((state & 0x0f) << 4)) & 0x7f   // & ~ATTACHMENT_ADD (0x80)
	return id
}

export function isHudAttachPoint(id) { return id >= HUD_MIN && id <= HUD_MAX }

/** Point local transform in avatar-node space (node = avatar center, +X fwd, y up, ground at
 *  −footOffset). Returns { pos: THREE.Vector3, quat: THREE.Quaternion } or null for HUD/unknown. */
export function attachPointLocal(id, footOffset) {
	const p = POINTS[id]
	if (!p) return null
	const [joint, px, py, pz, rx, ry, rz] = p
	const j = JOINT_REST[joint]
	if (!j) return null
	const sx = j[0] + px, sy = j[1] + py, sz = j[2] + pz
	const pos = new THREE.Vector3(sx, sz - footOffset, -sy)   // slToThree permutation
	// SL euler (deg) composes about FIXED axes X→Y→Z (LLQuaternion q = qz·qy·qx) — that's three.js
	// intrinsic order 'ZYX', NOT 'XYZ' (wrong order visibly mis-rotates Chest/Spine, the two points
	// with two non-zero axes). Build in SL axis space, then permute the vector part (x,z,−y).
	const d = Math.PI / 180
	const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx * d, ry * d, rz * d, 'ZYX'))
	const quat = new THREE.Quaternion(q.x, q.z, -q.y, q.w)
	return { pos, quat }
}

// SL→Three frame conversion C (matches slSkeleton.js SL_TO_THREE_QUAT: R_x(−90°)) and its inverse,
// prebuilt for the bone-local variant below.
const _CONV_INV = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)).invert()

/** 7·D: point transform LOCAL TO ITS BONE, for mounting on the live SL skeleton (slSkeleton.js).
 *  Bones sit in the SL frame under a root that carries the SL→Three conversion C, so the group's
 *  local offset is the RAW SL-metre point offset, and its rotation needs C factored back out:
 *  world = A·C·T_joint·anim·T_off·R_g must equal the legacy A·T₃·R₃ at rest, which (with
 *  R₃ = C·q_SL·C⁻¹, the permuted quat above) gives R_g = q_SL·C⁻¹. Children keep receiving
 *  three-frame (slToThree'd) transforms unchanged — and now ride the animated bone.
 *  Returns { joint, pos: Vector3 (SL, bone-local), quat } or null for HUD/unknown. */
export function attachPointBoneLocal(id) {
	const p = POINTS[id]
	if (!p) return null
	const [joint, px, py, pz, rx, ry, rz] = p
	const d = Math.PI / 180
	const qSL = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx * d, ry * d, rz * d, 'ZYX'))
	return { joint, pos: new THREE.Vector3(px, py, pz), quat: qSL.multiply(_CONV_INV) }
}
