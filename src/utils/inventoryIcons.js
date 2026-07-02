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

// Type-filter dropdown + Filters-panel checkboxes (FS "Filter: All Types ▾" / LLInventoryFilter).
// `types` lists matching AssetTypes; `invTypes` (optional) matches on InventoryType instead — used
// where AssetType is ambiguous (Snapshots share AssetType 0 (Texture) but carry InventoryType 15).
export const TYPE_FILTERS = [
	{ id: 'all',          label: 'All Types',     types: null },
	{ id: 'animations',   label: 'Animations',    types: [20] },
	{ id: 'bodyparts',    label: 'Body Parts',    types: [13] },
	{ id: 'callingcards', label: 'Calling Cards', types: [2] },
	{ id: 'clothing',     label: 'Clothing',      types: [5] },
	{ id: 'gestures',     label: 'Gestures',      types: [21] },
	{ id: 'landmarks',    label: 'Landmarks',     types: [3] },
	{ id: 'materials',    label: 'Materials',     types: [57] },
	{ id: 'meshes',       label: 'Meshes',        types: [49] },
	{ id: 'notecards',    label: 'Notecards',     types: [7] },
	{ id: 'objects',      label: 'Objects',       types: [6] },
	{ id: 'scripts',      label: 'Scripts',       types: [10, 11] },
	{ id: 'settings',     label: 'Settings',      types: [56] },
	{ id: 'snapshots',    label: 'Snapshots',     types: null, invTypes: [15] },
	{ id: 'sounds',       label: 'Sounds',        types: [1] },
	{ id: 'textures',     label: 'Textures',      types: [0] },
]

// The multi-select checkbox subset shown in the Filters panel — same entries minus the 'all' pseudo.
export const TYPE_FILTER_CHECKS = TYPE_FILTERS.filter(t => t.id !== 'all')

export function typeFilterLabel(id) {
	return (TYPE_FILTERS.find(t => t.id === id) || TYPE_FILTERS[0]).label
}

// True when `item` matches a single filter id (a TYPE_FILTERS entry). 'all'/falsy → matches everything.
export function itemMatchesType(item, typeId) {
	if (!typeId || typeId === 'all') return true
	const f = TYPE_FILTERS.find(t => t.id === typeId)
	if (!f) return true
	if (f.types && f.types.includes(item.assetType)) return true
	if (f.invTypes && f.invTypes.includes(item.invType ?? item.inventoryType)) return true
	return false
}

// True when `item` matches ANY of the filter ids in `set` (a Set or array of TYPE_FILTERS ids).
// An empty set (or one containing 'all') matches everything — the "no type filter" state.
export function itemMatchesTypeSet(item, set) {
	if (!set) return true
	const ids = set instanceof Set ? [...set] : set
	if (!ids.length || ids.includes('all')) return true
	return ids.some(id => itemMatchesType(item, id))
}

const ASSET_TYPE_NAMES = {
	0: 'Texture', 1: 'Sound', 2: 'Calling Card', 3: 'Landmark', 5: 'Clothing', 6: 'Object',
	7: 'Notecard', 8: 'Folder', 10: 'Script', 11: 'Script (bytecode)', 13: 'Body Part', 20: 'Animation',
	21: 'Gesture', 24: 'Link', 25: 'Folder Link', 49: 'Mesh', 56: 'Settings', 57: 'Material',
}
export function assetTypeName(t) { return ASSET_TYPE_NAMES[t] ?? `Type ${t}` }

export function itemIcon(assetType, invType) {
	return ITEM_ICONS[assetType] ?? INVTYPE_ICONS[invType] ?? '📄'
}

export function folderIcon(typeDefault, open) {
	const t = Number(typeDefault)
	if (FOLDER_ICONS[t]) return FOLDER_ICONS[t]
	return open ? '📂' : '📁'
}
