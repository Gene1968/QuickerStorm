// Day/night palette + pure mapping helpers. No Three.js / Vue deps (unit-testable).
// Drives the environment cycle: sun elevation → dayPhase → interpolated palette
// (sky/ambient/sun/fog colors + global exposure). See
// docs/superpowers/specs/2026-06-29-environment-day-night-design.md
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const smoothstep = (a, b, x) => {
	const t = clamp((x - a) / (b - a || 1e-6), 0, 1)
	return t * t * (3 - 2 * t)
}

// Keyframes by dayPhase (0 = deep night → 0.5 = horizon → 1 = high noon). Colors 0xRRGGBB.
export const PALETTE = [
	{ p: 0.0, skyZenith: 0x0a0f1e, skyHorizon: 0x1a2238, ambient: 0x26304d, sunColor: 0x3a4a6b, sunIntensity: 0.05, fog: 0x0a0f1e, exposure: 0.22, starOpacity: 1.0 },
	{ p: 0.5, skyZenith: 0x2b3a66, skyHorizon: 0xe8975a, ambient: 0x6b5a52, sunColor: 0xffb066, sunIntensity: 0.6, fog: 0xcaa07a, exposure: 0.55, starOpacity: 0.3 },
	{ p: 1.0, skyZenith: 0x3a7bd5, skyHorizon: 0x9ec9ee, ambient: 0xfff4e6, sunColor: 0xfff4e6, sunIntensity: 1.0, fog: 0x87ceeb, exposure: 1.0, starOpacity: 0.0 },
]

// Sun elevation = SL up-component (Z), clamped. SL world is Z-up, so dir[2] is sin(elevation).
export function elevationFromSunDir(dir) {
	return clamp(dir?.[2] ?? 0, -1, 1)
}

// elev -1..1 → phase 0..1. Horizon (elev 0) lands at 0.5; below horizon compresses toward night.
export function dayPhaseFromElevation(elev) {
	const e = clamp(elev, -1, 1)
	return e >= 0 ? 0.5 + 0.5 * smoothstep(0, 0.35, e) : 0.5 * smoothstep(-0.18, 0, e)
}

function lerpColor(a, b, t) {
	const ar = (a >> 16) & 255
	const ag = (a >> 8) & 255
	const ab = a & 255
	const br = (b >> 16) & 255
	const bg = (b >> 8) & 255
	const bb = b & 255
	const r = Math.round(ar + (br - ar) * t)
	const g = Math.round(ag + (bg - ag) * t)
	const bl = Math.round(ab + (bb - ab) * t)
	return (r << 16) | (g << 8) | bl
}
const lerp = (a, b, t) => a + (b - a) * t

export function samplePalette(phase) {
	const p = clamp(phase, 0, 1)
	let lo = PALETTE[0]
	let hi = PALETTE[PALETTE.length - 1]
	for (let i = 0; i < PALETTE.length - 1; i++) {
		if (p >= PALETTE[i].p && p <= PALETTE[i + 1].p) {
			lo = PALETTE[i]
			hi = PALETTE[i + 1]
			break
		}
	}
	const t = (p - lo.p) / ((hi.p - lo.p) || 1e-6)
	return {
		skyZenith: lerpColor(lo.skyZenith, hi.skyZenith, t),
		skyHorizon: lerpColor(lo.skyHorizon, hi.skyHorizon, t),
		ambient: lerpColor(lo.ambient, hi.ambient, t),
		sunColor: lerpColor(lo.sunColor, hi.sunColor, t),
		sunIntensity: lerp(lo.sunIntensity, hi.sunIntensity, t),
		fog: lerpColor(lo.fog, hi.fog, t),
		exposure: lerp(lo.exposure, hi.exposure, t),
		starOpacity: lerp(lo.starOpacity, hi.starOpacity, t),
	}
}
