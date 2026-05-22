/**
 * SP-style list name → Postgres table name.
 *
 * Used by src/api/ListApi.js so call sites that still say things like
 * `ListApi(_, 'apps').getAll(...)` or `ListApi(_, 'QuickerStorm Arcade Scores').getAll(...)`
 * land on the right table without being rewritten.
 *
 * Anything not listed falls through to `listName.toLowerCase().replace(/\s+/g, '_')`
 * — fine for simple names, won't be right for multi-word SP-style names; add
 * those here when they show up.
 */

const LIST_TO_TABLE = {
	users:                    'users',
	announcements:            'announcements',
	apps:                     'apps',
	'QuickerStorm Arcade Scores': 'arcade_scores',
	'QuickerStorm Ideas':         'ideas',
}

// Tables with jsonb columns whose callers historically treat them as strings.
// The ListApi shim parses these on write and stringifies them on read so the
// SP-shape contract (JSON-in-a-string) still holds.
const JSON_COLUMNS_BY_TABLE = {
	users:         new Set(['preferences', 'avatar_state', 'pending_invite']),
	announcements: new Set(),
	apps:          new Set(),
	arcade_scores: new Set(),
	ideas:         new Set(),
}

export function listNameToTable (listName) {
	if (LIST_TO_TABLE[listName]) return LIST_TO_TABLE[listName]
	return String(listName || '').toLowerCase().replace(/\s+/g, '_')
}

export function jsonColumnsForTable (table) {
	return JSON_COLUMNS_BY_TABLE[table] || new Set()
}
