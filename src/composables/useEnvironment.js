import { reactive, watch } from 'vue'
import { elevationFromSunDir, dayPhaseFromElevation, samplePalette } from '@/lib/environment.js'
import { useRealtimeSocket } from '@/composables/useRealtimeSocket.js'
import { useUiStore } from '@/stores/uiStore.js'
import { S } from '@shared/protocol.js'

// Single source of day/night state. Seeded by SimulatorViewerTimeMessage relays, extrapolated
// locally between samples. See docs/superpowers/specs/2026-06-29-environment-day-night-design.md

// Rotate a unit sun direction by an angular-velocity vector over dt seconds (rad), renormalize.
// Small-angle integration — server corrections re-seed often enough that drift is invisible.
export function advanceSunDir(dir, angVel, dt) {
	const w = [angVel[0] * dt, angVel[1] * dt, angVel[2] * dt]
	// out = dir + (w × dir), then renormalize
	const cx = w[1] * dir[2] - w[2] * dir[1]
	const cy = w[2] * dir[0] - w[0] * dir[2]
	const cz = w[0] * dir[1] - w[1] * dir[0]
	const nx = dir[0] + cx
	const ny = dir[1] + cy
	const nz = dir[2] + cz
	const len = Math.hypot(nx, ny, nz) || 1
	return [nx / len, ny / len, nz / len]
}

// Override time-of-day 0..1 → SL sun direction. 0.25 = sunrise(+X horizon), 0.5 = noon(+Z),
// 0.75 = sunset(-X horizon), 0/1 = midnight(-Z).
export function dirFromTimeOfDay(tod) {
	const a = 2 * Math.PI * (tod - 0.25)
	return [Math.cos(a), 0, Math.sin(a)]
}

const DEFAULT_SEC_PER_DAY = 14400
let _instance = null

export function useEnvironment() {
	if (_instance) return _instance

	const env = reactive({ palette: samplePalette(1), sunDirThree: { x: 0.4, y: 0.8, z: 0.4 }, phase: 1 })
	let sample = null // last server sample
	let curDir = [0.4, 0.8, 0.4] // SL-frame working sun dir (seed = pleasant midday)
	let cycleEnabled = true
	let override = null // 0..1 or null

	function ingestServerTime(d) {
		if (!d || !Array.isArray(d.sunDirection)) return
		sample = {
			sunAngVelocity: Array.isArray(d.sunAngVelocity) ? d.sunAngVelocity : [0, 0, 0],
			secPerDay: d.secPerDay || DEFAULT_SEC_PER_DAY,
		}
		curDir = d.sunDirection.slice()
	}

	function update(dt) {
		if (override != null) {
			curDir = dirFromTimeOfDay(override)
		} else if (cycleEnabled && sample) {
			curDir = advanceSunDir(curDir, sample.sunAngVelocity, dt)
		} // else: hold curDir (no data yet) — static local fallback
		const elev = elevationFromSunDir(curDir)
		const phase = dayPhaseFromElevation(elev)
		env.phase = phase
		env.palette = samplePalette(phase)
		// SL Z-up → Three Y-up, mirroring slToThree(x,y,z)=(x, z, -y)
		env.sunDirThree = { x: curDir[0], y: curDir[2], z: -curDir[1] }
	}

	function setOverride(v) { override = v }
	function setCycleEnabled(v) { cycleEnabled = !!v }

	// Subscribe to server time relays. `on(type, cb)` passes the full message → read `.d`.
	try {
		const { on } = useRealtimeSocket()
		on?.(S.ENVIRONMENT_TIME, (msg) => ingestServerTime(msg?.d))
	} catch { /* socket not ready (e.g. unit tests) */ }

	// Bind to the day/night prefs: cycle ON → follow region time; cycle OFF → fixed time-of-day.
	try {
		const ui = useUiStore()
		const applyPrefs = () => {
			setCycleEnabled(ui.dayNightCycle)
			setOverride(ui.dayNightCycle ? null : ui.timeOfDay)
		}
		applyPrefs()
		watch(() => [ui.dayNightCycle, ui.timeOfDay], applyPrefs)
	} catch { /* pinia not active (e.g. unit tests) */ }

	_instance = { env, update, ingestServerTime, setOverride, setCycleEnabled }
	return _instance
}
