// src/lib/seatEngine.js — pure decision logic for prim-sit/ground-sit + avatar reparenting.
// Kept separate from useWorldEngine.js (Three.js/store side effects) so the control-flag math
// and reparent/gating decisions are unit-testable without a WebGL context.

// SL AgentUpdate control flags (FS indra/llcommon/indra_constants.h:338-342):
//   AGENT_CONTROL_FLY          = 1<<13 (0x2000, already CTRL_FLY in useWorldEngine.js)
//   AGENT_CONTROL_STAND_UP     = 1<<16 (0x10000)
//   AGENT_CONTROL_SIT_ON_GROUND= 1<<17 (0x20000)
export const CTRL_STAND_UP      = 0x10000
export const CTRL_SIT_ON_GROUND = 0x20000

// NOTE (2026-07-13, Gene + FS ground truth): movement keys while seated do NOT stand you up in
// FS — LLAgent::moveAt/moveLeft/moveUp (llagent.cpp:763-914) have no isSitting branch and no
// standUp() call; the AGENT_CONTROL_* flags are sent and the sim ignores them unless a script
// took controls. Standing is only via the Stand button / dedicated sit-stand toggle key
// (llviewerinput.cpp:909-921 toggle_sit). An earlier shouldStandFromMovement() helper here
// implemented the opposite and was removed.

/**
 * Avatar reparent decision for the mesh-upsert existing-mesh branch (useWorldEngine.upsertMesh).
 * The sim confirms a prim-sit/stand by changing the avatar's ObjectUpdate/terse ParentID
 * (OpenSim ScenePresence.cs:3641-3648 HandleAgentSit sets ParentID then
 * SendAvatarDataToAllAgents; ground-sit, ScenePresence.cs:3662-3676, never sets it). Returns a
 * plain descriptor; the caller performs the actual Three.js attach()/detach() side effect.
 * @param {number|undefined} prevParentId
 * @param {number|undefined} newParentId
 * @returns {{changed:false}|{changed:true, action:'attach'|'detach', parentId:number}}
 */
export function resolveAvatarReparent(prevParentId, newParentId) {
	const prev = prevParentId ?? 0
	const next = newParentId ?? 0
	if (prev === next) return { changed: false }
	return { changed: true, action: next !== 0 ? 'attach' : 'detach', parentId: next }
}

/**
 * Buy(2)/Pay(3) cursor-badge gating for the object hover raycast (HoverCursorBadge).
 * Gene's rule (2026-07-13, approved deviation from FS's transient unknown-shows case): the Buy
 * pointer shows ONLY when the object is KNOWN to be for sale (saleType > 0). FS reaches the same
 * end state by requesting sale info on hover — cursorFromObject gates on node->mSaleInfo
 * (lltoolpie.cpp:589-594) which processObjectPropertiesFamily fills (llselectmgr.cpp:6421-6481).
 * We do the same: useWorldEngine's hover path fires RequestObjectPropertiesFamily for
 * clickAction=Buy objects with unknown saleType, so the badge appears as soon as the sim
 * confirms the sale (typically <1 round-trip) and never on not-for-sale objects.
 * Pay needs no sale state. Child-prim Buy/Pay is suppressed (they act on the linkset root).
 * @param {number} clickAction
 * @param {{isChild?: boolean, saleType?: number}} opts
 */
export function gateBuyHoverAction(clickAction, { isChild, saleType } = {}) {
	if (isChild && (clickAction === 2 || clickAction === 3)) return 0
	if (clickAction === 2 && !(Number(saleType) > 0)) return 0
	return clickAction
}
