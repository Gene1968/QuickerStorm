// server/lib/appearance.ts — avatar appearance helpers (bundle 7)
//
// Height estimation from the transmitted VisualParam byte array.
// Port of OpenSim's classic estimator (OpenSim/Framework/AvatarAppearance.cs SetHeight(),
// commented out there in favor of the viewer-sent AgentSetAppearance Size — which is exactly
// what WE are: the viewer. We compute it and send it as Size.Z; modern OpenSim then does
// m_avatarHeight = Size.Z in SetSize()). The client reuses the same number for placeholder scale.
//
// Param positions are INDICES into the transmitted array (ascending-ID tweakable sequence,
// FS llvoavatar.cpp parseAppearanceMessage), per OpenSim's VPElement enum:
//   SHAPE_HEIGHT=25 · SHAPE_MALE=31 · SHOES_HEEL_HEIGHT=77 · SHOES_PLATFORM_HEIGHT=78 ·
//   SHAPE_HEAD_SIZE=120 · SHAPE_LEG_LENGTH=125 · SHAPE_NECK_LENGTH=148

const VP = {
	SHAPE_HEIGHT: 25,
	SHAPE_MALE: 31,
	SHOES_HEEL_HEIGHT: 77,
	SHOES_PLATFORM_HEIGHT: 78,
	SHAPE_HEAD_SIZE: 120,
	SHAPE_LEG_LENGTH: 125,
	SHAPE_NECK_LENGTH: 148,
} as const

/** Default SL avatar height (matches the client's AVATAR_MODEL_HEIGHT / capsule). */
export const DEFAULT_AVATAR_HEIGHT = 1.8

/** A real appearance message carries the full tweakable set (~253 params on SL/OpenSim).
 *  Anything much shorter is a degenerate/legacy message — don't trust it for height or echo. */
export const MIN_PLAUSIBLE_PARAMS = 150

/** Estimate avatar height (metres) from the transmitted VisualParam bytes.
 *  OpenSim AvatarAppearance.cs SetHeight() formula (verified against the source checkout). */
export function estimateAvatarHeight(params: ArrayLike<number>): number {
	if (params.length < MIN_PLAUSIBLE_PARAMS) return DEFAULT_AVATAR_HEIGHT
	// Start with shortest possible female avatar height, add male offset + param contributions.
	let h = 1.14597
	if (params[VP.SHAPE_MALE]) h += 0.0848
	h += 0.516945 * params[VP.SHAPE_HEIGHT] / 255
		+ 0.08117 * params[VP.SHAPE_HEAD_SIZE] / 255
		+ 0.3836 * params[VP.SHAPE_LEG_LENGTH] / 255
		+ 0.07 * params[VP.SHOES_PLATFORM_HEIGHT] / 255
		+ 0.08 * params[VP.SHOES_HEEL_HEIGHT] / 255
		+ 0.076 * params[VP.SHAPE_NECK_LENGTH] / 255
	return Math.round(h * 1000) / 1000
}

/** Cheap dedup key for an appearance echo — params + bake TE bytes. */
export function appearanceEchoKey(params: ArrayLike<number>, te: Buffer | undefined): string {
	let hash = 5381
	for (let i = 0; i < params.length; i++) hash = ((hash << 5) + hash + params[i]) | 0
	if (te) for (let i = 0; i < te.length; i++) hash = ((hash << 5) + hash + te[i]) | 0
	return `${params.length}:${te?.length ?? 0}:${hash}`
}
