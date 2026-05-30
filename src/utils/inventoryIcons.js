// src/utils/inventoryIcons.js — map SL AssetType / FolderType to display glyphs.
// WHY: the inventory tree only has type numbers (no asset fetch), but those alone let us show
// Firestorm-style per-type icons. Emoji keeps it dependency-free and consistent with 📁/📄.

// SL AssetType (item.assetType / it.type). Subset we care to distinguish.
const ITEM_ICONS = {
	0:  '🖼️', // Texture
	1:  '🔊', // Sound
	2:  '📇', // CallingCard
	3:  '📍', // Landmark
	5:  '👕', // Clothing
	6:  '📦', // Object
	7:  '📒', // Notecard
	10: '📜', // LSLText (script)
	11: '📜', // LSLBytecode
	13: '🧍', // Bodypart
	20: '🎞️', // Animation
	21: '👋', // Gesture
	24: '🔗', // Link
	25: '🔗', // LinkFolder
	49: '🧊', // Mesh
	56: '⚙️', // Settings
	57: '🎨', // Material
}

// SL InventoryType — fallback when assetType is ambiguous (e.g. wearables).
const INVTYPE_ICONS = {
	0:  '🖼️', 1: '🔊', 2: '📇', 3: '📍', 6: '📦', 7: '📒',
	10: '📜', 15: '📸', 17: '📦', 18: '👕', 19: '🎞️', 20: '👋', 22: '🧊',
	56: '⚙️', 57: '🎨',
}

// FolderType / preferred_type (folder.typeDefault). -1 = ordinary user folder.
const FOLDER_ICONS = {
	0:  '🖼️', // Textures
	1:  '🔊', // Sounds
	2:  '📇', // Calling Cards
	3:  '📍', // Landmarks
	5:  '👕', // Clothing
	6:  '📦', // Objects
	7:  '📒', // Notecards
	10: '📜', // Scripts
	13: '🧍', // Body Parts
	14: '🗑️', // Trash
	15: '📸', // Photo Album / Snapshots
	16: '🧳', // Lost And Found
	20: '🎞️', // Animations
	21: '👋', // Gestures
	23: '⭐', // Favorites
	46: '🧥', // Current Outfit
	47: '👗', // Outfit
	48: '👗', // My Outfits
	49: '🧊', // Meshes
	56: '⚙️', // Settings
	57: '🎨', // Materials
}

export const FOLDER_FAVORITES      = 23
export const FOLDER_CURRENT_OUTFIT  = 46

export function itemIcon(assetType, invType) {
	return ITEM_ICONS[assetType] ?? INVTYPE_ICONS[invType] ?? '📄'
}

export function folderIcon(typeDefault, open) {
	const t = Number(typeDefault)
	if (FOLDER_ICONS[t]) return FOLDER_ICONS[t]
	return open ? '📂' : '📁'
}
