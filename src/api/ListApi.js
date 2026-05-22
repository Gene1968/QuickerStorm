/**
 * ListApi — thin PostgREST façade for the SharePoint-list-shaped call sites
 * that still expect `ListApi(siteUrl, tableName).getAll({ $filter, $select, … })`.
 *
 * Why a shim instead of rewriting call sites:
 *   OfficeShelf, AppGrid, SuggestionBoxModal, ArcadeSnakeModal, and MetricsView
 *   were all built against the SharePoint REST shape (`{ d: { results: [...] } }`
 *   with PascalCase columns and $filter strings). Supporting that shape here
 *   lets those callers stay put — new repos should use Supabase directly.
 *
 *   The first param is kept for call-site compatibility but is ignored; every
 *   call now goes to PostgREST regardless of what string you pass.
 *
 * Supported $filter grammar (the subset QuickerStorm actually uses):
 *   FieldName eq 'value'             → .eq('field_name', 'value')
 *   FieldName eq true                → .eq('field_name', true)
 *   FieldName eq <number>            → .eq('field_name', n)
 *   FieldName ne ''                  → .neq('field_name', '')
 *   FieldName gt datetime'2024-…'    → .gt('field_name', '2024-…')
 *   substringof('foo', Title)        → .ilike('title', '%foo%')
 *   A and B                          → both filters chained
 *
 * Anything more exotic logs a warning and falls through unfiltered — add a
 * dedicated Supabase repo for complex queries rather than extending the shim.
 *
 * Shape translation:
 *   PascalCase fields ↔ snake_case columns (with manual overrides below for
 *   names that don't translate mechanically, e.g. `Id → id`). jsonb columns
 *   are stringified on the way out so callers don't notice the type change.
 */
import { supabase } from './supabase/client.js'
import { listNameToTable, jsonColumnsForTable } from './supabase/listMap.js'

// PascalCase → snake_case (handles consecutive caps: "APIKey" → "api_key")
function camelToSnake (str) {
	return str
		.replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
		.replace(/([a-z\d])([A-Z])/g, '$1_$2')
		.toLowerCase()
}

function snakeToPascal (str) {
	return str.split('_').map(s => s ? s[0].toUpperCase() + s.slice(1) : '').join('')
}

// Some SP names don't translate mechanically — pin them here.
const FIELD_ALIAS_SP_TO_DB = {
	Id: 'id',
	With: 'with_party',                  // SQL reserved word
	DaysWithUTM:  'days_with_utm',
	DaysWithAPDP: 'days_with_apdp',
	DaysWithCFM:  'days_with_cfm',
}
const FIELD_ALIAS_DB_TO_SP = Object.fromEntries(
	Object.entries(FIELD_ALIAS_SP_TO_DB).map(([sp, db]) => [db, sp]),
)

function spToDbField (sp) {
	if (FIELD_ALIAS_SP_TO_DB[sp]) return FIELD_ALIAS_SP_TO_DB[sp]
	return camelToSnake(sp)
}
function dbToSpField (db) {
	if (FIELD_ALIAS_DB_TO_SP[db]) return FIELD_ALIAS_DB_TO_SP[db]
	if (db === 'id') return 'Id'
	return snakeToPascal(db)
}

function rowToSp (row, jsonCols) {
	if (!row) return row
	const out = {}
	for (const [k, v] of Object.entries(row)) {
		const spKey = dbToSpField(k)
		if (jsonCols.has(k) && v != null && typeof v !== 'string') {
			out[spKey] = JSON.stringify(v)
		} else {
			out[spKey] = v
		}
	}
	return out
}

function spToDbPayload (payload, jsonCols) {
	const out = {}
	for (const [k, v] of Object.entries(payload)) {
		const dbKey = spToDbField(k)
		if (jsonCols.has(dbKey) && typeof v === 'string') {
			try { out[dbKey] = v ? JSON.parse(v) : null } catch { out[dbKey] = v }
		} else {
			out[dbKey] = v
		}
	}
	return out
}

// ── $filter parser ──────────────────────────────────────────────────────────
const TOKEN_AND   = /\s+and\s+/i
const RE_EQ_STR   = /^([A-Za-z_][A-Za-z0-9_]*)\s+(eq|ne)\s+'((?:[^']|'')*)'$/
const RE_EQ_NUM   = /^([A-Za-z_][A-Za-z0-9_]*)\s+(eq|ne|gt|ge|lt|le)\s+(-?\d+(?:\.\d+)?)$/
const RE_EQ_BOOL  = /^([A-Za-z_][A-Za-z0-9_]*)\s+(eq|ne)\s+(true|false)$/i
const RE_DATETIME = /^([A-Za-z_][A-Za-z0-9_]*)\s+(eq|ne|gt|ge|lt|le)\s+datetime'([^']+)'$/
const RE_SUBSTR   = /^substringof\('((?:[^']|'')*)',\s*([A-Za-z_][A-Za-z0-9_]*)\)$/
const OP_MAP      = { eq: 'eq', ne: 'neq', gt: 'gt', ge: 'gte', lt: 'lt', le: 'lte' }

function parseFilter (filter) {
	if (!filter) return []
	const parts = filter.split(TOKEN_AND).map(s => s.trim())
	const out = []
	for (const part of parts) {
		let m
		if ((m = RE_DATETIME.exec(part))) {
			out.push({ op: OP_MAP[m[2]], field: spToDbField(m[1]), value: m[3] })
		} else if ((m = RE_EQ_STR.exec(part))) {
			out.push({ op: OP_MAP[m[2]], field: spToDbField(m[1]), value: m[3].replace(/''/g, "'") })
		} else if ((m = RE_EQ_BOOL.exec(part))) {
			out.push({ op: OP_MAP[m[2]], field: spToDbField(m[1]), value: m[3].toLowerCase() === 'true' })
		} else if ((m = RE_EQ_NUM.exec(part))) {
			out.push({ op: OP_MAP[m[2]], field: spToDbField(m[1]), value: Number(m[3]) })
		} else if ((m = RE_SUBSTR.exec(part))) {
			out.push({ op: 'ilike', field: spToDbField(m[2]), value: `%${m[1].replace(/''/g, "'")}%` })
		} else {
			console.warn('[ListApi] unsupported $filter clause, ignored:', part)
		}
	}
	return out
}

// ── Factory ─────────────────────────────────────────────────────────────────
export default function ListApi (_ignoredSiteUrl, listname, _ignoredFolderName) {
	const table    = listNameToTable(listname)
	const jsonCols = jsonColumnsForTable(table)

	function notImpl (method) {
		return async () => {
			console.warn(`[ListApi] ${method}() not implemented for table "${table}"`)
			return null
		}
	}

	async function getAll (query = {}) {
		const sb = supabase()
		let columns = '*'
		if (query.$select) {
			columns = query.$select.split(',').map(s => spToDbField(s.trim())).join(',')
		}
		let q = sb.from(table).select(columns)

		for (const f of parseFilter(query.$filter)) q = q[f.op](f.field, f.value)

		if (query.$orderby) {
			const parts = query.$orderby.split(',').map(s => s.trim())
			for (const part of parts) {
				const [field, dir] = part.split(/\s+/)
				q = q.order(spToDbField(field), { ascending: !/desc/i.test(dir || '') })
			}
		}

		const top = query.$top ? Math.min(Number(query.$top), 5000) : 5000
		q = q.limit(top)

		const { data, error } = await q
		if (error) throw error
		// Mimic SP shape: { d: { results: [...] } }
		return { d: { results: (data || []).map(r => rowToSp(r, jsonCols)) } }
	}

	async function getItem (query, id) {
		const sb = supabase()
		let columns = '*'
		if (query?.$select) {
			columns = query.$select.split(',').map(s => spToDbField(s.trim())).join(',')
		}
		const { data, error } = await sb.from(table).select(columns).eq('id', id).single()
		if (error) throw error
		return { d: rowToSp(data, jsonCols) }
	}

	async function createListItem (payload) {
		const sb = supabase()
		const dbPayload = spToDbPayload(payload, jsonCols)
		const { data, error } = await sb.from(table).insert(dbPayload).select('*').single()
		if (error) throw error
		return { d: rowToSp(data, jsonCols) }
	}

	async function updateListItem (payload, id) {
		const sb = supabase()
		const dbPayload = spToDbPayload(payload, jsonCols)
		const { error, status } = await sb.from(table).update(dbPayload).eq('id', id)
		if (error) {
			if (error.code === 'PGRST116') return { status: 404, ok: false }
			throw error
		}
		return { status, ok: status >= 200 && status < 300 }
	}

	async function deleteListItem (id) {
		const sb = supabase()
		const { error, status } = await sb.from(table).delete().eq('id', id)
		if (error) throw error
		return { status, ok: status >= 200 && status < 300 }
	}

	return {
		getAll,
		getAllWithMeta: async (q) => { const data = await getAll(q); return { response: { ok: true, status: 200 }, data } },
		getItem,
		getItemWithMeta: async (q, id) => { const data = await getItem(q, id); return { response: { ok: true, status: 200 }, data } },
		createListItem,
		updateListItem,
		deleteListItem,
		// File/attachment ops belong on Supabase Storage — not implemented in this shim.
		createListAttachment: notImpl('createListAttachment'),
		deleteListAttachment: notImpl('deleteListAttachment'),
		uploadFile:           notImpl('uploadFile'),
		uploadFileToFolder:   notImpl('uploadFileToFolder'),
		getFileItem:          notImpl('getFileItem'),
		deleteFile:           notImpl('deleteFile'),
		getChoices:           notImpl('getChoices'),
		getFieldTypes:        notImpl('getFieldTypes'),
	}
}
