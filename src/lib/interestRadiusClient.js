// src/lib/interestRadiusClient.js — compute the interest radius the client asks the relay to filter
// to. Driven by the draw-distance slider, shrunk under memory pressure (governor), and ramped up on
// arrival (FS send_agent_update: start max(target/2, 50), grow 10%/sec to target) so the immediate
// vicinity paints first instead of bursting the whole volume.

const PRESSURE_FACTOR = 0.6   // under heap pressure, ask for a smaller volume
const RAMP_START_FLOOR = 50   // metres — FS arrival ramp floor
const RAMP_RATE_PER_S = 0.10  // +10% of target per second

/**
 * @param {{ drawDistance: number, underPressure: boolean, arrivalElapsedMs: number }} o
 * @returns {number} interest radius in metres (integer)
 */
export function computeInterestRadius({ drawDistance, underPressure, arrivalElapsedMs }) {
	let target = drawDistance
	if (underPressure) target = target * PRESSURE_FACTOR
	const start = Math.max(target / 2, RAMP_START_FLOOR)
	const elapsedS = Math.max(0, arrivalElapsedMs) / 1000
	const ramped = Math.min(target, start + elapsedS * target * RAMP_RATE_PER_S)
	return Math.round(ramped)
}
