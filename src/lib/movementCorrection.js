// src/lib/movementCorrection.js — pure decision for how hard an inbound sim TerseUpdate
// position should correct the client's dead-reckoned avatar position.
// Returns a blend factor in [0,1] applied as: pos += (simPos - pos) * blend.
//
// WHY three regimes:
//  - Grounded: trust the sim when idle (settle accumulated DR drift), ignore corrections
//    while moving (DR owns the stride), snap only on a large gap (>5m = teleport / hard physics).
//  - Airborne (jump arc): local physics owns the parabola; the sim's pos lags by ~RTT, so
//    suppress ALL corrections under 15m and snap only on teleport-scale.
//  - Flying: the SAME situation as a jump — local DR owns the flight path while the sim trails
//    by RTT and climbs/coasts on a different accel profile, so transient gaps of 5-30m are
//    NORMAL. The old code lumped flight into the GROUNDED regime, so the >5m hard-snap fired
//    mid-flight and yanked the avatar back to the lagging sim position ("spring to startpoint").
//    Flight now: trust DR while a movement key is held (blend 0), settle gently at rest so the
//    post-key coast reconciles, and snap only on a teleport-scale gap.

export const GROUND_SNAP_DIST = 5   // m — grounded gap that forces an instant snap
export const AIR_SNAP_DIST    = 15  // m — jump-arc gap that forces an instant snap
export const FLY_SNAP_DIST    = 30  // m — flight gap that forces an instant snap (teleport-scale)
export const SETTLE_BLEND     = 0.15 // gentle ease toward the sim when at rest

// d         : distance (m) between sim pos and client pos
// isFlying  : sustained fly state
// airborne  : in a jump arc (caller passes !isFlying && (vertVel||landingGrace))
// movingNow : a movement key is held OR residual DR skid velocity remains
export function correctionBlend({ d, isFlying, airborne, movingNow }) {
	if (isFlying) return d > FLY_SNAP_DIST ? 1 : (movingNow ? 0 : SETTLE_BLEND)
	if (airborne) return d > AIR_SNAP_DIST ? 1 : 0
	return d > GROUND_SNAP_DIST ? 1 : (movingNow ? 0 : SETTLE_BLEND)
}
