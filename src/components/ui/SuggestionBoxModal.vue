<script setup>
/**
 * SuggestionBoxModal — Ideas & feature board backed by SharePoint.
 *
 * SharePoint list: "quickerSTORM Ideas"  (create manually, columns below)
 *   Title        Single line of text  (required — idea name)
 *   Description  Multiple lines of text / plain
 *   Category     Single line of text
 *   Status       Single line of text
 *   Notes        Multiple lines of text / plain  (decline reason, blocker detail, etc.)
 *   AuthorName   Single line of text
 *   AuthorEmail  Single line of text
 */
import { ref, nextTick, onMounted, onUnmounted, computed } from 'vue'
import { AgGridVue } from 'ag-grid-vue3'
import { ModuleRegistry, AllCommunityModule, themeQuartz } from 'ag-grid-community'
import ListApi from '@/api/ListApi.js'
import { supabase } from '@/api/supabase/client.js'
import { openModal, closeModal } from '@/composables/useModalStack.js'
import { config } from '@/config/configuration.js'
import { useAvatarStore } from '@/stores/avatarStore.js'
import { useTheme } from '@/composables/useTheme.js'

ModuleRegistry.registerModules([AllCommunityModule])

defineEmits(['close'])

const avatarStore = useAvatarStore()
const { isDark } = useTheme()
const listApi = ListApi(config.siteUrl, 'quickerSTORM Ideas')

// ── ag-grid theme — reactive to dark/light ───────────────────────
const gridTheme = computed(() =>
	isDark.value
		? themeQuartz.withParams({
			accentColor:               '#00b4d8',
			backgroundColor:           'var(--color-bg)',
			foregroundColor:           '#d0dff0',
			borderColor:               'var(--color-brd)',
			chromeBackgroundColor:     'var(--color-card2)',
			rowHoverColor:             '#162540',
			selectedRowBackgroundColor:'#1a3050',
			headerBackgroundColor:     'var(--color-card2)',
			headerTextColor:           '#6a90b8',
			inputBorderColor:          'var(--color-brd)',
			inputFocusBorderColor:     '#00b4d8',
			cellTextColor:             '#c8daf0',
			oddRowBackgroundColor:     '#0d1a2e',
			fontSize:                  '0.8125rem',
			rowHeight:                 36,
			headerHeight:              38,
		})
		: themeQuartz.withParams({
			accentColor:               'var(--color-accent)',
			backgroundColor:           'var(--color-card)',
			foregroundColor:           'var(--color-t1)',
			borderColor:               'var(--color-brd)',
			chromeBackgroundColor:     'var(--color-card2)',
			rowHoverColor:             'var(--color-bg2)',
			selectedRowBackgroundColor:'var(--color-bg2)',
			headerBackgroundColor:     'var(--color-card2)',
			headerTextColor:           'var(--color-t2)',
			inputBorderColor:          'var(--color-brd)',
			inputFocusBorderColor:     'var(--color-accent)',
			cellTextColor:             'var(--color-t1)',
			oddRowBackgroundColor:     'var(--color-bg)',
			fontSize:                  '0.8125rem',
			rowHeight:                 36,
			headerHeight:              38,
		})
)

const CATEGORIES = ['Feature', 'Content', 'UX', 'Performance', 'Integration', 'Bug', 'Other']
const STATUSES   = ['Idea', 'Considering', 'Exploring', 'Prioritized', 'In Progress', 'Done', 'Blocked', 'Improve it', 'Declined']

const STATUS_MEANINGS = {
	'Idea':              'Just submitted — not yet reviewed',
	'Considering':       'On the radar; gathering context before committing',
	'Exploring':         'Actively investigating feasibility or design',
	'Prioritized':       'Approved and scheduled for development',
	'In Progress':       'Being built right now',
	'Done':              'Shipped and available',
	'Blocked':           'Paused — waiting on something external; see Notes',
	'Improve it': 'Good concept but needs refinement before it can move forward; see Notes',
	'Declined':          'Won\'t pursue at this time; see Notes for reasoning',
}

// ── State ────────────────────────────────────────────────────────────
const loading  = ref(true)
const error    = ref(null)
const rowData  = ref([])
const quickFilter = ref('')
const showDone     = ref(false)
const showDeclined = ref(false)
const gridApi  = ref(null)
const saving   = ref(new Set())  // set of row ids being saved

const myVotedIds        = ref(new Set())  // Set<number> idea IDs this user voted for
const voteCounts        = ref(new Map())  // Map<number, number> idea_id → total votes
const VOTE_SLOTS        = 5

const myActiveVoteCount = computed(() => {
	let n = 0
	for (const id of myVotedIds.value) {
		const row = rowData.value.find(r => r._id === id)
		if (!row || row.Status !== 'Done') n++
	}
	return n
})

const visibleRowData = computed(() =>
	rowData.value.filter(row => {
		if (row.Status === 'Done'     && !showDone.value)     return false
		if (row.Status === 'Declined' && !showDeclined.value) return false
		return true
	})
)

// ── Column defs ──────────────────────────────────────────────────────
const defaultColDef = {
	sortable: true,
	resizable: true,
	filter: false,
	suppressMovable: true,
}

function escapeHtml(s) {
	return String(s)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;')
}

/** http(s) segments in plain multiline text (SharePoint plain-text fields). */
const URL_IN_TEXT_RE = /https?:\/\/[^\s<]+/gi

function linkifyPlainText(text) {
	if (text == null || text === '') return ''
	return String(text)
		.split(/\r?\n/)
		.map((line) => {
			const escaped = escapeHtml(line)
			return escaped.replace(URL_IN_TEXT_RE, (url) => {
				const safe = escapeHtml(url)
				return `<a href="${safe}" target="_blank" rel="noopener noreferrer" class="sb-cell-link">${safe}</a>`
			})
		})
		.join('<br>')
}

function linkifiedCellRenderer(params) {
	const wrap = document.createElement('div')
	wrap.className = 'sb-linkify-cell'
	wrap.innerHTML = linkifyPlainText(params.value)
	return wrap
}

const columnDefs = [
	{
		field: '_votes',
		headerName: 'Votes',
		width: 80,
		editable: false,
		sortable: true,
		valueGetter: (p) => voteCounts.value.get(p.data?._id) || 0,
		cellRenderer: voteRenderer,
		cellStyle: { display: 'flex', alignItems: 'center', padding: '0 0.5rem' },
	},
	{
		field: 'Title',
		headerName: 'Idea / Feature',
		flex: 2,
		minWidth: 160,
		editable: true,
		cellStyle: { fontWeight: '600' },
	},
	{
		field: 'Description',
		headerName: 'Description',
		flex: 3,
		minWidth: 200,
		editable: true,
		cellRenderer: linkifiedCellRenderer,
		wrapText: true,
		autoHeight: true,
		cellStyle: { lineHeight: '1.45', paddingTop: '0.375rem', paddingBottom: '0.375rem' },
	},
	{
		field: 'Category',
		headerName: 'Category',
		width: 130,
		editable: true,
		cellEditor: 'agSelectCellEditor',
		cellEditorParams: { values: CATEGORIES },
	},
	{
		field: 'Status',
		headerName: 'Status',
		width: 140,
		editable: true,
		cellEditor: 'agSelectCellEditor',
		cellEditorParams: { values: STATUSES },
		cellStyle: (p) => statusStyle(p.value),
		tooltipValueGetter: (p) => STATUS_MEANINGS[p.value] || '',
	},
	{
		field: 'Notes',
		headerName: 'Notes',
		flex: 2,
		minWidth: 160,
		editable: true,
		cellRenderer: linkifiedCellRenderer,
		wrapText: true,
		autoHeight: true,
		cellStyle: { lineHeight: '1.45', paddingTop: '0.375rem', paddingBottom: '0.375rem', fontStyle: 'italic' },
	},
	{
		field: 'OwnerName',
		headerName: 'Assigned to',
		width: 130,
		editable: true,
		cellStyle: { color: '#6a90b8' },
	},
	{
		field: 'AuthorName',
		headerName: 'Added by',
		width: 130,
		editable: false,
		cellStyle: { color: '#6a90b8' },
	},
	{
		field: 'Modified',
		headerName: 'Updated',
		width: 100,
		editable: false,
		cellStyle: { color: '#6a90b8' },
		valueFormatter: (p) => p.value ? new Date(p.value).toLocaleDateString() : '',
	},
]

function statusStyle(status) {
	const colors = {
		'Idea':         '#4a80b8',
		'Considering':  '#7055a8',
		'Exploring':    '#4a7a9a',
		'Prioritized':  '#c8902a',
		'In Progress':  '#3a9a6a',
		'Done':         '#4a7840',
		'Blocked':           '#b85a3a',
		'Improve it': '#a07830',
		'Declined':          '#607080',
	}
	return { color: colors[status] || '#6a90b8', fontWeight: '600' }
}

// ── Votes ─────────────────────────────────────────────────────────────
async function loadVotes() {
	const sb = supabase()
	const { data, error } = await sb.from('idea_votes').select('idea_id,voter_email')
	if (error) { console.warn('[Ideas] vote load failed:', error.message); return }
	const myEmail = avatarStore.avaEmail?.toLowerCase()
	const counts  = new Map()
	const myIds   = new Set()
	for (const v of data || []) {
		counts.set(v.idea_id, (counts.get(v.idea_id) || 0) + 1)
		if (v.voter_email?.toLowerCase() === myEmail) myIds.add(v.idea_id)
	}
	voteCounts.value = counts
	myVotedIds.value = myIds
}

async function toggleVote(ideaId) {
	const sb      = supabase()
	const myEmail = avatarStore.avaEmail
	if (!myEmail || !ideaId) return
	if (myVotedIds.value.has(ideaId)) {
		const { error } = await sb.from('idea_votes').delete()
			.eq('idea_id', ideaId).eq('voter_email', myEmail)
		if (error) { console.warn('[Ideas] unvote failed:', error.message); return }
		const next = new Set(myVotedIds.value); next.delete(ideaId)
		myVotedIds.value = next
		const nextMap = new Map(voteCounts.value)
		nextMap.set(ideaId, Math.max(0, (nextMap.get(ideaId) || 1) - 1))
		voteCounts.value = nextMap
	} else {
		if (myActiveVoteCount.value >= VOTE_SLOTS) return
		const { error } = await sb.from('idea_votes').insert({ idea_id: ideaId, voter_email: myEmail })
		if (error) { console.warn('[Ideas] vote failed:', error.message); return }
		const next = new Set(myVotedIds.value); next.add(ideaId)
		myVotedIds.value = next
		const nextMap = new Map(voteCounts.value)
		nextMap.set(ideaId, (nextMap.get(ideaId) || 0) + 1)
		voteCounts.value = nextMap
	}
	gridApi.value?.refreshCells({ force: true, columns: ['_votes'] })
}

function voteRenderer(params) {
	const id      = params.data?._id
	const status  = params.data?.Status
	const count   = voteCounts.value.get(id) || 0
	const voted   = myVotedIds.value.has(id)
	const isDone  = status === 'Done'
	const canVote = voted || myActiveVoteCount.value < VOTE_SLOTS

	const btn = document.createElement('button')
	btn.className = 'sb-vote-btn' + (voted ? ' sb-voted' : '') + (isDone ? ' sb-vote-done' : '')
	btn.disabled  = isDone || (!voted && !canVote)
	btn.title     = isDone
		? 'Done — vote slot freed'
		: voted
			? 'Remove vote'
			: canVote
				? `Vote (${VOTE_SLOTS - myActiveVoteCount.value} left)`
				: 'No votes remaining (5/5 used)'
	btn.innerHTML = `${voted ? '★' : '☆'}&thinsp;<span class="sb-vc">${count}</span>`
	if (!isDone) btn.addEventListener('click', e => { e.stopPropagation(); toggleVote(id) })
	return btn
}

// ── Data loading ─────────────────────────────────────────────────────
onMounted(openModal)
onUnmounted(closeModal)
onMounted(async () => {
	try {
		const [raw] = await Promise.all([
			listApi.getAll({
				$select: 'Id,Title,Description,Category,Status,Notes,AuthorName,AuthorEmail,OwnerName,Modified',
				$orderby: 'Modified desc',
			}),
			loadVotes(),
		])
		const items = raw?.d?.results || []

		rowData.value = items.map(item => ({
			_id:          item.Id,
			_isNew:       false,
			Title:        item.Title        || '',
			Description:  item.Description  || '',
			Category:     item.Category     || '',
			Status:       item.Status       || 'Idea',
			Notes:        item.Notes        || '',
			OwnerName:    item.OwnerName    || '',
			AuthorName:   item.AuthorName   || '',
			AuthorEmail:  item.AuthorEmail  || '',
			Modified:     item.Modified     || '',
		}))
	} catch (err) {
		error.value = err.message || 'Could not load ideas'
	} finally {
		loading.value = false
	}
})

// ── Grid ready ───────────────────────────────────────────────────────
function onGridReady(params) {
	gridApi.value = params.api
}

// ── Add new row ──────────────────────────────────────────────────────
function addRow() {
	quickFilter.value = ''
	const newRow = {
		_id:         null,
		_isNew:      true,
		Title:       '',
		Description: '',
		Category:    '',
		Status:      'Idea',
		Notes:       '',
		OwnerName:   '',
		AuthorName:  avatarStore.displayName || '',
		AuthorEmail: avatarStore.avaEmail    || '',
		Modified:    new Date().toISOString(),
	}
	rowData.value = [newRow, ...rowData.value]
	nextTick(() => {
		gridApi.value?.startEditingCell({ rowIndex: 0, colKey: 'Title' })
	})
}

// ── Auto-save on cell change ─────────────────────────────────────────
async function onCellValueChanged(params) {
	const data = params.data
	// Use a stable key to debounce / guard concurrent saves for the same row
	const rowKey = data._id ?? '_new_' + params.rowIndex
	if (saving.value.has(rowKey)) return
	saving.value = new Set([...saving.value, rowKey])
	try {
		if (data._isNew) {
			const result = await listApi.createListItem({
				Title:       data.Title       || 'Untitled',
				Description: data.Description || '',
				Category:    data.Category    || '',
				Status:      data.Status      || 'Idea',
				Notes:       data.Notes       || '',
				OwnerName:   data.OwnerName   || '',
				AuthorName:  data.AuthorName  || '',
				AuthorEmail: data.AuthorEmail || '',
			})
			const newId = result?.d?.Id
			if (newId) {
				data._id    = newId
				data._isNew = false
				params.node.setData(data)
			}
		} else if (data._id) {
			await listApi.updateListItem({
				Title:       data.Title       || '',
				Description: data.Description || '',
				Category:    data.Category    || '',
				Status:      data.Status      || '',
				Notes:       data.Notes       || '',
				OwnerName:   data.OwnerName   || '',
			}, data._id)
		}
		// When Status changes, vote budget may shift — refresh vote cells
		if (params.column?.colId === 'Status') {
			await nextTick()
			gridApi.value?.refreshCells({ force: true, columns: ['_votes'] })
		}
	} catch (err) {
		console.warn('[SuggestionBox] save failed:', err.message)
	} finally {
		saving.value = new Set([...saving.value].filter(k => k !== rowKey))
	}
}
</script>

<template>
	<Teleport to="body">
		<div class="sb-overlay" @click.self="$emit('close')">
			<div class="sb-panel">
				<!-- Header -->
				<div class="sb-header">
					<div class="sb-header-left">
						<span class="sb-icon">💡</span>
						<span class="sb-title">Ideas Board</span>
						<span class="sb-hint">Click any cell to edit · changes save automatically</span>
					</div>
					<div class="sb-header-actions">
						<label class="sb-done-toggle">
							<input v-model="showDeclined" type="checkbox" />
							<span>Show declined</span>
						</label>
						<label class="sb-done-toggle">
							<input v-model="showDone" type="checkbox" />
							<span>Show done</span>
						</label>
						<button class="sb-close" @click="$emit('close')" aria-label="Close">✕</button>
					</div>
				</div>

				<!-- Toolbar -->
				<div class="sb-toolbar justify-between">
					<input
						class="sb-search"
						v-model="quickFilter"
						placeholder="Search ideas…"
						type="search"
					/>
					<span>Please search first! It may be here already, but feel free to edit any</span>
					<span class="sb-vote-budget" :class="{ 'sb-vb-full': myActiveVoteCount >= VOTE_SLOTS }">
						⭐ {{ myActiveVoteCount }}/{{ VOTE_SLOTS }} votes
					</span>
					<button class="sb-add-btn" @click="addRow">+ Add idea</button>
				</div>

				<!-- Grid -->
				<div class="sb-grid-wrap">
					<div v-if="loading" class="sb-loading">Loading…</div>
					<div v-else-if="error" class="sb-error">{{ error }}</div>
					<AgGridVue
						v-else
						class="sb-grid"
						:theme="gridTheme"
						:row-data="visibleRowData"
						:column-defs="columnDefs"
						:default-col-def="defaultColDef"
						:quick-filter-text="quickFilter"
						:animate-rows="true"
						:stop-editing-when-cells-lose-focus="true"
						@grid-ready="onGridReady"
						@cell-value-changed="onCellValueChanged"
					/>
				</div>
			</div>
		</div>
	</Teleport>
</template>

<style scoped>
.sb-overlay {
	position: fixed;
	inset: 0;
	background: rgba(0, 0, 0, 0.7);
	display: flex;
	align-items: center;
	justify-content: center;
	z-index: 800;
	backdrop-filter: blur(4px);
}

.sb-panel {
	width: min(82rem, 96vw);
	height: 86vh;
	background: var(--color-card);
	border: 1px solid var(--color-brd);
	border-radius: 0.875rem;
	box-shadow: 0 20px 80px rgba(0, 0, 0, 0.7);
	display: flex;
	flex-direction: column;
	overflow: hidden;
}

/* Header */
.sb-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 0.875rem 1.25rem;
	border-bottom: 1px solid var(--color-brd);
	background: var(--color-card2);
	flex-shrink: 0;
	gap: 1rem;
}
.sb-header-left {
	display: flex;
	align-items: center;
	gap: 0.625rem;
	min-width: 0;
}
.sb-icon { font-size: 1.125rem; flex-shrink: 0; }
.sb-title {
	font-size: clamp(0.875rem, 0.875vw, 1.0625rem);
	font-weight: 700;
	color: var(--color-t1);
	flex-shrink: 0;
}
.sb-hint {
	font-size: 0.6875rem;
	color: var(--color-tm);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.sb-header-actions {
	display: flex;
	align-items: center;
	gap: 0.75rem;
	flex-shrink: 0;
}
.sb-done-toggle {
	display: inline-flex;
	align-items: center;
	gap: 0.375rem;
	color: var(--color-t2);
	font-size: 0.75rem;
	font-weight: 600;
	white-space: nowrap;
	cursor: pointer;
}
.sb-done-toggle input {
	width: 0.875rem;
	height: 0.875rem;
	accent-color: var(--color-accent);
	cursor: pointer;
}
.sb-close {
	background: none;
	border: none;
	color: var(--color-tm);
	font-size: 0.9375rem;
	cursor: pointer;
	padding: 0.25rem 0.375rem;
	border-radius: 0.25rem;
	flex-shrink: 0;
	line-height: 1;
}
.sb-close:hover { color: var(--color-t1); background: rgba(255,255,255,0.05); }

/* Toolbar */
.sb-toolbar {
	display: flex;
	align-items: center;
	gap: 0.75rem;
	padding: 0.625rem 1.25rem;
	border-bottom: 1px solid var(--color-brd);
	background: var(--color-card2);
	flex-shrink: 0;
	color: var(--color-t1);
}
.sb-search {
	flex: 1;
	max-width: 22rem;
	background: var(--color-bg);
	border: 1px solid var(--color-brd);
	border-radius: 0.4375rem;
	color: var(--color-t1);
	font-size: 0.8125rem;
	padding: 0.4375rem 0.75rem;
	outline: none;
	transition: border-color 0.15s;
}
.sb-search:focus { border-color: var(--color-accent); }
.sb-search::placeholder { color: var(--color-tm); }

.sb-add-btn {
	background: var(--color-accent);
	border: none;
	border-radius: 0.4375rem;
	color: #fff;
	font-size: 0.8125rem;
	font-weight: 600;
	padding: 0.4375rem 1rem;
	cursor: pointer;
	transition: background 0.15s;
	white-space: nowrap;
}
.sb-add-btn:hover { background: var(--color-accent2); }

/* Grid */
.sb-grid-wrap {
	flex: 1;
	min-height: 0;
	padding: 0.75rem;
}
.sb-grid { width: 100%; height: 100%; }

.sb-loading,
.sb-error {
	display: flex;
	align-items: center;
	justify-content: center;
	height: 100%;
	font-size: 0.875rem;
	color: var(--color-tm);
}
.sb-error { color: #c04040; }

/* Vote budget badge */
.sb-vote-budget {
	font-size: 0.75rem;
	font-weight: 600;
	color: var(--color-t2);
	white-space: nowrap;
	padding: 0.25rem 0.625rem;
	border-radius: 1rem;
	background: var(--color-bg);
	border: 1px solid var(--color-brd);
}
.sb-vb-full {
	color: #c04040;
	border-color: #c04040;
}

/* ag-grid injects renderer DOM without Vue scoped attrs */
.sb-grid :deep(.sb-linkify-cell) {
	word-break: break-word;
}
.sb-grid :deep(.sb-linkify-cell .sb-cell-link) {
	color: var(--color-accent);
	text-decoration: underline;
	text-underline-offset: 2px;
}
.sb-grid :deep(.sb-linkify-cell .sb-cell-link:hover) {
	filter: brightness(1.1);
}

.sb-grid :deep(.sb-vote-btn) {
	background: none;
	border: 1px solid var(--color-brd);
	border-radius: 0.375rem;
	color: var(--color-tm);
	font-size: 0.8125rem;
	padding: 0.125rem 0.5rem;
	cursor: pointer;
	display: inline-flex;
	align-items: center;
	gap: 0.125rem;
	transition: border-color 0.15s, color 0.15s;
	line-height: 1.4;
}
.sb-grid :deep(.sb-vote-btn:hover:not(:disabled)) {
	border-color: var(--color-accent);
	color: var(--color-accent);
}
.sb-grid :deep(.sb-vote-btn.sb-voted) {
	border-color: #f0b429;
	color: #f0b429;
}
.sb-grid :deep(.sb-vote-btn.sb-vote-done) {
	opacity: 0.45;
	cursor: default;
}
.sb-grid :deep(.sb-vote-btn:disabled:not(.sb-vote-done)) {
	opacity: 0.4;
	cursor: not-allowed;
}
.sb-grid :deep(.sb-vc) {
	font-variant-numeric: tabular-nums;
}
</style>
