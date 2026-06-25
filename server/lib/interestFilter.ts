// Phase 0 — Bun-side camera-driven interest filter (validation spike).
//
// WHY: On a default OpenSim grid, ObjectsCullingByDistance is OFF, so the sim floods the
// relay with ALL region objects (~21k on Aspen) regardless of the viewer's draw distance.
// The browser tries to build every one → worldStore/buildQ/assets balloon → ~4GB tab heap
// pins → load wedges. The relay (Bun) has headroom and already knows every object's region
// position (session.objCache) plus the live camera (session.lastAgentParams). So we forward
// to the browser only the objects inside a camera-centred interest volume, and KillObject the
// rest as they leave / re-send as they enter — FS-like streaming with a bounded working set.
//
// This module is the PURE core (geometry + enter/leave diff). The wiring that gates the
// forward path and drives the reconcile tick lives in server/handlers/lludp.ts.

export type Vec3 = [number, number, number]

/** Minimal shape we read off a decoded ObjectUpdate record stored in session.objCache. */
export interface ObjLike {
	localId?: number
	parentId?: number
	pos?: Vec3
	pcode?: number
}

/** SL/OpenSim primitive code for an avatar. Avatars are never culled. */
const PCODE_AVATAR = 47

/** Is the Bun-side interest filter enabled? Flag-gated, default OFF (validation spike). */
export function interestEnabled(): boolean {
	return process.env.INTEREST_FILTER === '1'
}

/** Interest radius in metres. Tunable live via INTEREST_R; default 96m. */
export function interestRadius(): number {
	const r = Number(process.env.INTEREST_R)
	return Number.isFinite(r) && r > 0 ? r : 96
}

/**
 * Is `pos` within `r` metres of the camera? Uses squared distance (no sqrt — hot path).
 * A null position means we don't know where the object is yet → treat as in-interest so we
 * never cull an object we can't place (the reconcile tick re-evaluates once its root arrives).
 */
export function withinInterest(pos: Vec3 | null, cam: Vec3, r: number): boolean {
	if (!pos) return true
	const dx = pos[0] - cam[0]
	const dy = pos[1] - cam[1]
	const dz = pos[2] - cam[2]
	return dx * dx + dy * dy + dz * dz <= r * r
}

/**
 * Resolve an object's effective REGION position. A child prim's `pos` is a parent-relative
 * offset, not a region coordinate, so walk up parentId links to the linkset root (parentId 0)
 * and use the root's region position. This keeps a whole linkset together — in or out as a unit.
 * Returns null if the root isn't cached yet (caller forwards by default).
 */
export function effectivePos(
	obj: ObjLike,
	getObj: (id: number) => ObjLike | undefined,
	maxHops = 6,
): Vec3 | null {
	let cur: ObjLike | undefined = obj
	let hops = 0
	while (cur && (cur.parentId ?? 0) !== 0 && hops < maxHops) {
		cur = getObj(cur.parentId!)
		hops++
	}
	// Resolved to a root prim (parentId 0) with a real position.
	if (cur && (cur.parentId ?? 0) === 0 && Array.isArray(cur.pos)) return cur.pos
	return null
}

/** True for avatars, which are always kept regardless of distance. */
export function isAvatar(obj: ObjLike): boolean {
	return obj.pcode === PCODE_AVATAR
}

export interface ReconcileResult {
	/** localIds now in-interest but not yet forwarded → forward (replay from objCache). */
	enter: number[]
	/** localIds previously forwarded but now out-of-interest → KillObject. */
	leave: number[]
}

/**
 * Hysteresis: an object enters at radius `r` but isn't killed until it passes `r * LEAVE_MARGIN`.
 * Without this, objects sitting near the boundary flap (enter → leave → enter) every tick as the
 * camera jitters, causing visible flicker and churn. The dead band keeps streaming stable.
 */
export const LEAVE_MARGIN = 1.15

/**
 * Diff the current interest volume against what the browser has. Pure: caller applies the
 * result (forwards `enter` objects, sends KillObject for `leave`, updates the `sent` set).
 * Avatars always enter and never leave. Already-shown objects survive out to `r * leaveMargin`.
 */
export function reconcileInterest(
	objCache: Map<number, ObjLike>,
	sent: Set<number>,
	cam: Vec3,
	r: number,
	leaveMargin = LEAVE_MARGIN,
): ReconcileResult {
	const enter: number[] = []
	const leave: number[] = []
	const rLeave = r * leaveMargin
	const getObj = (id: number) => objCache.get(id)

	for (const [localId, obj] of objCache) {
		const shown = sent.has(localId)
		if (isAvatar(obj)) {
			if (!shown) enter.push(localId)   // avatars: always in, never leave
			continue
		}
		const pos = effectivePos(obj, getObj)
		if (shown) {
			if (!withinInterest(pos, cam, rLeave)) leave.push(localId)
		} else {
			if (withinInterest(pos, cam, r)) enter.push(localId)
		}
	}

	return { enter, leave }
}
