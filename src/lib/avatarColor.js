// src/lib/avatarColor.js — deterministic per-avatar placeholder ("jellydoll") color.
//
// Ported from Firestorm LLVOAvatar::calcMutedAVColor (indra/newview/llvoavatar.cpp, the
// #ifdef COLORIZE_JELLYDOLLS branch): pick a hue from the FIRST BYTE of the avatar UUID and lerp it
// through a 7-stop spectrum (red→magenta→blue→cyan→green→yellow→red) so every avatar gets a stable,
// evenly-distributed, distinct color. FS then normalizes the RGB vector and scales by 0.28 because it's
// a *mute overlay* tint; here it's our PRIMARY placeholder render, so we scale to BRIGHTNESS (~0.7) for
// visibility while keeping FS's hue distribution identical. Same UUID → same color, always.

// One RGB channel changes between each adjacent stop and it loops back to red for an even wrap — this is
// FS's exact spectrum_color[] array, NOT a heat map.
const SPECTRUM = [
	[1, 0, 0], // red
	[1, 0, 1], // magenta
	[0, 0, 1], // blue
	[0, 1, 1], // cyan
	[0, 1, 0], // green
	[1, 1, 0], // yellow
	[1, 0, 0], // red (wrap)
]

// First hex byte of the UUID (0-255). Tolerates dashes/case/whitespace; falls back to 0x80 (mid-spectrum)
// for a malformed/empty id so we never throw at render time.
function firstByte(uuid) {
	const hex = String(uuid || '').replace(/[^0-9a-fA-F]/g, '').slice(0, 2)
	const b = parseInt(hex, 16)
	return Number.isFinite(b) ? b : 0x80
}

/** Deterministic RGB (each channel 0..1) for an avatar UUID. `brightness` is the vector length after
 *  normalize (FS uses 0.28; default 0.7 reads well as a primary capsule). Pure — unit-tested. */
export function jellydollColorRGB(uuid, brightness = 0.7) {
	const spectrum = (firstByte(uuid) / 256) * (SPECTRUM.length - 1) // 0 .. 6
	const i1 = Math.floor(spectrum)
	const i2 = Math.min(i1 + 1, SPECTRUM.length - 1)
	const f = spectrum - i1
	const c1 = SPECTRUM[i1], c2 = SPECTRUM[i2]
	let r = c1[0] + (c2[0] - c1[0]) * f
	let g = c1[1] + (c2[1] - c1[1]) * f
	let b = c1[2] + (c2[2] - c1[2]) * f
	const len = Math.hypot(r, g, b) || 1
	return { r: (r / len) * brightness, g: (g / len) * brightness, b: (b / len) * brightness }
}

/** Same as jellydollColorRGB but packed as a 0xRRGGBB integer for THREE.Color.setHex(). */
export function jellydollColorHex(uuid, brightness = 0.7) {
	const { r, g, b } = jellydollColorRGB(uuid, brightness)
	const q = (v) => Math.max(0, Math.min(255, Math.round(v * 255)))
	return (q(r) << 16) | (q(g) << 8) | q(b)
}
