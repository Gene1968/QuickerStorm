// src/lib/assetSerialize.js — SL/Firestorm notecard + inventory-type asset serialization.
// WHY: notecard assets on the wire/disk are NOT raw text — they're wrapped in the
// "Linden text version N" embedded-items envelope (llnotecard.cpp exportStream). We
// only ever write notecards with zero embedded inventory items (count 0), so this is
// a deliberately narrow port: enough to round-trip plain-text notecards, not a full
// LLEmbeddedItems implementation. LSL scripts have no envelope at all (identity).

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** Wrap notecard text in the "Linden text version 2" envelope (llnotecard.cpp exportStream). */
export function notecardToAsset(text) {
	const byteLen = encoder.encode(text).length
	return (
		'Linden text version 2\n' +
		'{\n' +
		'LLEmbeddedItems version 1\n' +
		'{\n' +
		'count 0\n' +
		'}\n' +
		`Text length ${byteLen}\n` +
		text +
		'}\n'
	)
}

/**
 * Inverse of notecardToAsset: pull the note text back out of a full notecard asset
 * string. Accepts both "version 1" and "version 2" headers. If no recognizable
 * envelope is present (bare notecard, e.g. from an older grid), returns it unchanged.
 */
export function notecardFromAsset(assetStr) {
	if (typeof assetStr !== 'string') return assetStr
	if (!/^Linden text version \d+\n/.test(assetStr)) return assetStr

	const marker = 'Text length '
	const markerIdx = assetStr.indexOf(marker)
	if (markerIdx === -1) return assetStr

	const lineEnd = assetStr.indexOf('\n', markerIdx)
	if (lineEnd === -1) return assetStr

	const byteLen = parseInt(assetStr.slice(markerIdx + marker.length, lineEnd), 10)
	if (!Number.isFinite(byteLen)) return assetStr

	// Text starts right after the "Text length N\n" line, and is byteLen UTF-8 bytes long.
	const textStart = lineEnd + 1
	const fullBytes = encoder.encode(assetStr.slice(textStart))
	const textBytes = fullBytes.slice(0, byteLen)
	return decoder.decode(textBytes)
}

/** LSL script assets are raw UTF-8 text with no envelope — identity, kept for symmetry. */
export function scriptToAsset(text) {
	return text
}

/** Inverse of scriptToAsset — identity. */
export function scriptFromAsset(assetStr) {
	return assetStr
}

// Wire-level asset type codes (llassettype.cpp LLAssetType::EType).
export const ASSET_TYPE = {
	texture: 0,
	sound: 1,
	landmark: 3,
	notecard: 7,
	lsltext: 10,
	animation: 20,
}

// Wire-level inventory type codes (llinventorytype.cpp LLInventoryType::EType).
export const INV_TYPE = {
	texture: 0,
	sound: 1,
	landmark: 3,
	notecard: 7,
	script: 10,
	animation: 19,
}

// Asset-type wire strings (llassettype.cpp mAssetTypeNames). NOTE: 'animatn' is
// deliberately truncated — that's the real SL wire string, not a typo.
export const ASSET_TYPE_STR = {
	texture: 'texture',
	sound: 'sound',
	landmark: 'landmark',
	notecard: 'notecard',
	lsltext: 'lsltext',
	animation: 'animatn',
}

// Inventory-type wire strings (llinventorytype.cpp mInventoryTypeNames).
export const INV_TYPE_STR = {
	texture: 'texture',
	sound: 'sound',
	landmark: 'landmark',
	notecard: 'notecard',
	script: 'script',
	animation: 'animation',
}

/**
 * Look up the {assetType, invType, assetTypeStr, invTypeStr} quadruple for a kind.
 * Notecard and script are the only kinds we create locally, so this is intentionally
 * narrow. Scripts are the odd one out: the asset-type wire string is 'lsltext' but the
 * inventory-type wire string is 'script' (see ASSET_TYPE_STR/INV_TYPE_STR above).
 */
export function assetKindFor(kind) {
	if (kind === 'notecard') {
		return {
			assetType: ASSET_TYPE.notecard,
			invType: INV_TYPE.notecard,
			assetTypeStr: ASSET_TYPE_STR.notecard,
			invTypeStr: INV_TYPE_STR.notecard,
		}
	}
	if (kind === 'script') {
		return {
			assetType: ASSET_TYPE.lsltext,
			invType: INV_TYPE.script,
			assetTypeStr: ASSET_TYPE_STR.lsltext,
			invTypeStr: INV_TYPE_STR.script,
		}
	}
	throw new Error(`assetKindFor: unknown kind "${kind}"`)
}
