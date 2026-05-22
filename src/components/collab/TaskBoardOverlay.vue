<script setup>
/**
 * TaskBoardOverlay — Full-screen task board UI.
 * Mirrors WhiteboardOverlay's permission-state machine.
 */
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useTaskBoard } from '@/composables/useTaskBoard.js'
import { useAvatarStore } from '@/stores/avatarStore.js'
import TaskBoard from './TaskBoard.vue'
import TaskBoardSetup from './TaskBoardSetup.vue'
import TaskBoardSettings from './TaskBoardSettings.vue'
import TaskBoardHistory from './TaskBoardHistory.vue'

const props = defineProps({
	docId:      { type: String, required: true },
	roomId:     { type: String, required: true },
	persistent: { type: Boolean, default: true },
})

const emit = defineEmits(['close'])

const avatarStore = useAvatarStore()

const {
	columns, cardsByColumn,
	connected, synced, awareness,
	connect, disconnect,
	addColumn, renameColumn, deleteColumn, seedDefaultColumns,
	addCard, updateCard, deleteCard, moveCard,
	setFocus, clearFocus,
	role, access, isNew, denied, docTitle, docMembers, archived, locked, readOnly, isOwner,
	setupBoard, updatePermissions, archiveBoard, saveBoard, setLocked, listHistory,
} = useTaskBoard(props.docId, {
	roomId: props.roomId,
	persistent: props.persistent,
	title: `Tasks - ${props.roomId}`,
})

// ── Per-card focus index from awareness ─────────────────────────────────
const awarenessVersion = ref(0)
let _unsubAwareness = null
onMounted(() => {
	if (awareness) _unsubAwareness = awareness.onChange(() => awarenessVersion.value++)
})
onUnmounted(() => { if (_unsubAwareness) _unsubAwareness() })

const focusByCard = computed(() => {
	awarenessVersion.value  // dep
	const map = new Map()
	if (!awareness) return map
	const localId = awareness.clientId
	for (const [clientId, state] of awareness.getStates()) {
		if (clientId === localId) continue
		if (!state || state.kind !== 'tb-focus' || !state.cardId) continue
		if (!map.has(state.cardId)) map.set(state.cardId, [])
		map.get(state.cardId).push({
			userName: state.userName || 'User',
			color: state.color || '#3b82f6',
		})
	}
	return map
})

function handleCardFocus(cardId) {
	setFocus(cardId, avatarStore.displayName || 'User', avatarStore.color || '#3b82f6')
}
function handleCardBlur() { clearFocus() }

// ── UI State ────────────────────────────────────────────────────────────
const isMaximized = ref(true)
const showSettings = ref(false)
const showHistory = ref(false)
const historyBoards = ref([])
const historyLoading = ref(false)

onMounted(() => connect())
onUnmounted(() => disconnect())

watch(denied, (val) => {
	if (val && (val.reason === 'archived' || val.reason === 'access-revoked')) {
		setTimeout(() => handleClose(), 3000)
	}
})

// ── Setup flow ──────────────────────────────────────────────────────────
async function handleSetupComplete(config) {
	try {
		await setupBoard(config.title, config.access, config.members)
		// Owner seeds default columns after setup
		seedDefaultColumns()
	} catch (e) { console.error('[taskboard] setup failed:', e) }
}

async function handleSettingsUpdate(config) {
	try {
		await updatePermissions(config.access, config.members, config.title)
		showSettings.value = false
	} catch (e) { console.error('[taskboard] update permissions failed:', e) }
}

async function handleArchive() {
	try {
		await archiveBoard()
		emit('close')
	} catch (e) { console.error('[taskboard] archive failed:', e) }
}

async function handleSave() {
	try {
		await saveBoard()
		emit('close')
	} catch (e) { console.error('[taskboard] save failed:', e) }
}

async function handleSetLocked(next) {
	try { await setLocked(next) }
	catch (e) { console.error('[taskboard] setLocked failed:', e) }
}

async function openHistory() {
	showSettings.value = false
	showHistory.value = true
	historyLoading.value = true
	try {
		const boards = await listHistory()
		historyBoards.value = (boards || []).filter(b => !b.type || b.type === 'taskboard')
	} catch (e) {
		console.error('[taskboard] list history failed:', e)
		historyBoards.value = []
	} finally {
		historyLoading.value = false
	}
}

function handleHistoryOpen(archivedDocId) {
	showHistory.value = false
	emit('close', { reopenAs: archivedDocId })
}

function handleClose() { emit('close') }
function toggleMaximize() { isMaximized.value = !isMaximized.value }

// ── Column / Card actions ───────────────────────────────────────────────
function handleAddColumn() {
	const title = prompt('Column name:')
	if (title && title.trim()) addColumn(title.trim())
}
function handleAddCard(columnId) { addCard({ columnId, title: 'New task' }) }
</script>

<template>
	<div class="tb-overlay" :class="{ maximized: isMaximized, floating: !isMaximized }">
		<!-- DENIED -->
		<template v-if="denied">
			<div class="tb-denied">
				<div class="denied-icon">🔒</div>
				<h3 class="denied-title">Board is Private</h3>
				<p class="denied-desc" v-if="denied.reason === 'no-access'">You don't have access to this board.</p>
				<p class="denied-desc" v-else-if="denied.reason === 'archived'">This board has been archived.</p>
				<p class="denied-desc" v-else-if="denied.reason === 'access-revoked'">Your access has been revoked.</p>
				<p class="denied-desc" v-else>Access denied.</p>
				<button class="denied-close" @click="handleClose">Close</button>
			</div>
		</template>

		<!-- SETUP -->
		<template v-else-if="isNew">
			<div class="tb-header">
				<div class="tb-header-left">
					<span class="tb-title">New Task Board</span>
				</div>
				<div class="tb-header-right">
					<button class="tb-btn close-btn" @click="handleClose" title="Close">✕</button>
				</div>
			</div>
			<TaskBoardSetup @setup="handleSetupComplete" @close="handleClose" />
		</template>

		<!-- NORMAL / READ-ONLY -->
		<template v-else>
			<div class="tb-header">
				<div class="tb-header-left">
					<span class="tb-title">{{ docTitle || 'Task Board' }}</span>
					<span v-if="archived" class="tb-role archived">Archived</span>
					<span v-else-if="role" class="tb-role" :class="role">
						{{ role === 'owner' ? 'Owner' : role === 'editor' ? 'Editor' : 'View Only' }}
					</span>
					<span v-if="synced" class="tb-status synced">synced</span>
					<span v-else-if="connected" class="tb-status connecting">connecting...</span>
				</div>
				<div class="tb-header-right">
					<button v-if="isOwner" class="tb-btn" @click="showHistory = false; showSettings = !showSettings" title="Settings">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
						</svg>
					</button>
					<button class="tb-btn" @click="openHistory" title="Board History">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
						</svg>
					</button>
					<button class="tb-btn" @click="toggleMaximize" :title="isMaximized ? 'Minimize' : 'Maximize'">
						<span v-if="isMaximized">⊡</span>
						<span v-else>⊞</span>
					</button>
					<button class="tb-btn close-btn" @click="handleClose" title="Close">✕</button>
				</div>
			</div>

			<div v-if="archived && locked" class="readonly-banner readonly-banner--locked">
				Archived Board — Read-only snapshot from history.
				<button v-if="isOwner" class="rb-action" @click="handleSetLocked(false)">Allow editing</button>
			</div>
			<div v-else-if="archived" class="readonly-banner readonly-banner--saved">
				Saved Snapshot — In history but still editable. Archive to lock.
				<button v-if="isOwner" class="rb-action" @click="handleSetLocked(true)">Lock now</button>
			</div>
			<div v-else-if="readOnly" class="readonly-banner">View Only — You can see this board but cannot make changes.</div>

			<div class="tb-body">
				<TaskBoard
					:columns="columns"
					:cards-by-column="cardsByColumn"
					:read-only="readOnly"
					:focus-by-card="focusByCard"
					@add-column="handleAddColumn"
					@rename-column="(id, title) => renameColumn(id, title)"
					@delete-column="deleteColumn"
					@add-card="handleAddCard"
					@update-card="(id, updates) => updateCard(id, updates)"
					@delete-card="deleteCard"
					@move-card="(id, colId, idx) => moveCard(id, colId, idx)"
					@card-focus="handleCardFocus"
					@card-blur="handleCardBlur"
				/>

				<TaskBoardSettings
					v-if="showSettings && isOwner"
					:doc-title="docTitle"
					:access="access"
					:is-owner="true"
					:current-members="docMembers"
					:archived="archived"
					:locked="locked"
					@update="handleSettingsUpdate"
					@archive="handleArchive"
					@save="handleSave"
					@set-locked="handleSetLocked"
					@close="showSettings = false"
				/>

				<TaskBoardHistory
					v-if="showHistory"
					:boards="historyBoards"
					:loading="historyLoading"
					@open="handleHistoryOpen"
					@close="showHistory = false"
				/>
			</div>
		</template>
	</div>
</template>

<style scoped>
.tb-overlay {
	display: flex; flex-direction: column; background: #f1f5f9; border-radius: 12px; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
	z-index: 600;
}
.tb-overlay.maximized { position: fixed; top: 20px; left: 20px; right: 20px; bottom: calc(3.25rem + 20px); }
.tb-overlay.floating { position: fixed; top: 60px; right: 20px; width: 800px; height: 540px; max-height: calc(100vh - 3.25rem - 80px); resize: both; }

.tb-header { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: #1e293b; color: #f8fafc; flex-shrink: 0; user-select: none; }
.tb-header-left { display: flex; align-items: center; gap: 10px; }
.tb-title { font-weight: 600; font-size: 14px; }
.tb-role { font-size: 11px; padding: 2px 8px; border-radius: 4px; font-weight: 500; }
.tb-role.owner    { background: #f59e0b; color: #1e293b; }
.tb-role.editor   { background: #3b82f6; color: #fff; }
.tb-role.viewer   { background: #64748b; color: #fff; }
.tb-role.archived { background: #7c3aed; color: #fff; }
.tb-status { font-size: 11px; padding: 2px 6px; border-radius: 4px; }
.tb-status.synced { background: #16a34a; }
.tb-status.connecting { background: #ca8a04; }
.tb-header-right { display: flex; gap: 4px; }
.tb-btn { background: none; border: none; color: #f8fafc; font-size: 16px; cursor: pointer; padding: 4px 8px; border-radius: 4px; line-height: 1; }
.tb-btn:hover { background: rgba(255, 255, 255, 0.1); }
.close-btn:hover { background: #dc2626; }

.tb-body { flex: 1; position: relative; display: flex; overflow: hidden; }
.readonly-banner {
	display: flex; align-items: center; justify-content: center; gap: 0.5rem;
	padding: 0.375rem 0.75rem;
	background: #fef3c7; color: #92400e;
	font-size: 0.75rem; text-align: center; font-weight: 500;
	flex-shrink: 0;
}
.readonly-banner--locked { background: rgba(124, 58, 237, 0.15); color: #7c3aed; }
.readonly-banner--saved  { background: rgba(0, 180, 216, 0.15); color: var(--color-accent); }
.rb-action {
	background: rgba(255, 255, 255, 0.5);
	border: 1px solid currentColor;
	color: inherit;
	font-size: 0.6875rem;
	padding: 0.125rem 0.5rem;
	border-radius: 0.25rem;
	cursor: pointer;
	font-weight: 600;
}
.rb-action:hover { background: #fff; }

.tb-denied { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 40px; text-align: center; flex: 1; }
.denied-icon { font-size: 48px; margin-bottom: 16px; }
.denied-title { font-size: 18px; font-weight: 700; color: #1e293b; margin: 0 0 8px; }
.denied-desc { font-size: 14px; color: #64748b; margin: 0 0 24px; }
.denied-close { padding: 8px 20px; border: none; border-radius: 6px; background: #1e293b; color: #fff; font-size: 13px; cursor: pointer; }
.denied-close:hover { background: #334155; }
</style>
