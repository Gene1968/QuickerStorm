<script setup>
/**
 * WhiteboardOverlay — Full-screen collaborative whiteboard UI.
 *
 * Handles permission states: denied, setup (first-open), read-only, normal editing.
 */
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useAvatarStore } from '@/stores/avatarStore.js'
import { useWhiteboard, STICKY_COLORS } from '@/composables/useWhiteboard.js'
import DrawingCanvas from './DrawingCanvas.vue'
import StickyNote from './StickyNote.vue'
import ShapeElement from './ShapeElement.vue'
import WhiteboardToolbar from './WhiteboardToolbar.vue'
import CursorOverlay from './CursorOverlay.vue'
import WhiteboardSetup from './WhiteboardSetup.vue'
import WhiteboardSettings from './WhiteboardSettings.vue'
import WhiteboardHistory from './WhiteboardHistory.vue'

const props = defineProps({
	docId: { type: String, required: true },
	roomId: { type: String, required: true },
	persistent: { type: Boolean, default: true },
})

const emit = defineEmits(['close'])

const avatarStore = useAvatarStore()

const {
	stickies, strokes, shapes,
	connected, synced, awareness,
	connect, disconnect,
	addSticky, updateSticky, deleteSticky, voteSticky,
	addStroke, deleteStroke, clearStrokes,
	addShape, updateShape, deleteShape,
	clearAll, setCursor, clearCursor,
	// Permissions
	role, access, isNew, denied, owner, docTitle, docMembers, archived, locked, readOnly, isOwner,
	setupBoard, updatePermissions, archiveBoard, setLocked, createNewBoard, listHistory,
} = useWhiteboard(props.docId, {
	roomId: props.roomId,
	persistent: props.persistent,
	title: `Whiteboard - ${props.roomId}`,
})

// ── UI State ────────────────────────────────────────────────────────────
const activeTool = ref('select')
const penColor = ref('#1e293b')
const penWidth = ref(3)
const stickyColor = ref(STICKY_COLORS[0])
const isMaximized = ref(true)
const boardRef = ref(null)
const showSettings = ref(false)
const showHistory = ref(false)
const historyBoards = ref([])
const historyLoading = ref(false)

// ── Lifecycle ───────────────────────────────────────────────────────────
onMounted(() => {
	connect()
})

// Auto-close after 3s when board is archived or access revoked (for non-owner users)
watch(denied, (val) => {
	if (val && (val.reason === 'archived' || val.reason === 'access-revoked')) {
		setTimeout(() => handleClose(), 3000)
	}
})

onUnmounted(() => {
	clearCursor()
	disconnect()
})

// ── Tool Actions ────────────────────────────────────────────────────────
function handleToolChange(tool) {
	activeTool.value = tool
}

function handleAddSticky() {
	activeTool.value = 'select'
	const x = 200 + Math.random() * 400
	const y = 150 + Math.random() * 300
	addSticky({ x, y, color: stickyColor.value })
}

function handleStrokeComplete(points) {
	if (points.length < 2) return
	addStroke({ points, color: penColor.value, width: penWidth.value })
}

function handleStrokeErase(strokeId) {
	deleteStroke(strokeId)
}

function handleAddShape(type) {
	activeTool.value = 'select'
	const x = 300 + Math.random() * 200
	const y = 200 + Math.random() * 200
	addShape({ type, x, y })
}

function handleShapeUpdate(id, updates) {
	updateShape(id, updates)
}

function handleShapeDelete(id) {
	deleteShape(id)
}

function handleStickyUpdate(id, updates) {
	updateSticky(id, updates)
}

function handleStickyDelete(id) {
	deleteSticky(id)
}

function handleStickyVote(id, userId) {
	voteSticky(id, userId)
}

// ── Setup flow ──────────────────────────────────────────────────────────
async function handleSetupComplete(config) {
	try {
		await setupBoard(config.title, config.access, config.members)
	} catch (e) {
		console.error('[whiteboard] setup failed:', e)
	}
}

// ── Settings & History ───────────────────────────────────────────────────
async function handleSettingsUpdate(config) {
	try {
		await updatePermissions(config.access, config.members, config.title)
		showSettings.value = false
	} catch (e) {
		console.error('[whiteboard] update permissions failed:', e)
	}
}

async function handleArchive() {
	try {
		await archiveBoard()
		emit('close')
	} catch (e) {
		console.error('[whiteboard] archive failed:', e)
	}
}

async function handleSetLocked(next) {
	try { await setLocked(next) }
	catch (e) { console.error('[whiteboard] setLocked failed:', e) }
}

async function openHistory() {
	showSettings.value = false
	showHistory.value = true
	historyLoading.value = true
	try {
		const boards = await listHistory()
		historyBoards.value = boards || []
	} catch (e) {
		console.error('[whiteboard] list history failed:', e)
		historyBoards.value = []
	} finally {
		historyLoading.value = false
	}
}

function handleHistoryOpen(archivedDocId) {
	// TODO: open archived board in read-only mode
	showHistory.value = false
	console.log('[whiteboard] open archived:', archivedDocId)
}

// ── Mouse tracking for cursor awareness ─────────────────────────────────
function handleMouseMove(e) {
	if (!boardRef.value) return
	const rect = boardRef.value.getBoundingClientRect()
	const x = e.clientX - rect.left
	const y = e.clientY - rect.top
	setCursor(x, y, avatarStore.displayName || 'Me', avatarStore.color || '#3b82f6')
}

function handleMouseLeave() {
	clearCursor()
}

function handleClose() {
	emit('close')
}

function toggleMaximize() {
	isMaximized.value = !isMaximized.value
}

// Role badge label
const roleBadge = computed(() => {
	if (role.value === 'owner') return 'Owner'
	if (role.value === 'editor') return 'Editor'
	if (role.value === 'viewer') return 'View Only'
	return ''
})
</script>

<template>
	<div
		class="whiteboard-overlay"
		:class="{ maximized: isMaximized, floating: !isMaximized }"
	>
		<!-- DENIED STATE -->
		<template v-if="denied">
			<div class="wb-denied">
				<div class="denied-icon">🔒</div>
				<h3 class="denied-title">Whiteboard is Private</h3>
				<p class="denied-desc" v-if="denied.reason === 'no-access'">
					You don't have access to this whiteboard.
				</p>
				<p class="denied-desc" v-else-if="denied.reason === 'archived'">
					This whiteboard has been archived.
				</p>
				<p class="denied-desc" v-else-if="denied.reason === 'access-revoked'">
					Your access has been revoked.
				</p>
				<p class="denied-desc" v-else>
					Access denied.
				</p>
				<button class="denied-close" @click="handleClose">Close</button>
			</div>
		</template>

		<!-- SETUP STATE (first open) -->
		<template v-else-if="isNew">
			<div class="wb-header">
				<div class="wb-header-left">
					<span class="wb-title">New Whiteboard</span>
				</div>
				<div class="wb-header-right">
					<button class="wb-btn close-btn" @click="handleClose" title="Close">✕</button>
				</div>
			</div>
			<WhiteboardSetup @setup="handleSetupComplete" @close="handleClose" />
		</template>

		<!-- NORMAL / READ-ONLY STATE -->
		<template v-else>
			<!-- Header bar -->
			<div class="wb-header">
				<div class="wb-header-left">
					<span class="wb-title">{{ docTitle || 'Whiteboard' }}</span>
					<span v-if="archived" class="wb-role archived">Archived</span>
					<span v-else-if="roleBadge" class="wb-role" :class="role">{{ roleBadge }}</span>
					<span v-if="synced" class="wb-status synced">synced</span>
					<span v-else-if="connected" class="wb-status connecting">connecting...</span>
				</div>
				<div class="wb-header-right">
					<button v-if="isOwner" class="wb-btn" @click="showHistory = false; showSettings = !showSettings" title="Settings">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
						</svg>
					</button>
					<button class="wb-btn" @click="openHistory" title="Board History">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
						</svg>
					</button>
					<button class="wb-btn" @click="toggleMaximize" :title="isMaximized ? 'Minimize' : 'Maximize'">
						<span v-if="isMaximized">⊡</span>
						<span v-else>⊞</span>
					</button>
					<button class="wb-btn close-btn" @click="handleClose" title="Close">✕</button>
				</div>
			</div>

			<!-- Toolbar (hidden in read-only mode) -->
			<WhiteboardToolbar
				v-if="!readOnly"
				:active-tool="activeTool"
				:pen-color="penColor"
				:pen-width="penWidth"
				:sticky-color="stickyColor"
				@tool-change="handleToolChange"
				@add-sticky="handleAddSticky"
				@add-shape="handleAddShape"
				@clear-all="clearAll"
				@update:pen-color="penColor = $event"
				@update:pen-width="penWidth = $event"
				@update:sticky-color="stickyColor = $event"
			/>

			<!-- Read-only banner -->
			<div v-if="archived && locked" class="readonly-banner readonly-banner--locked">
				Archived Board — Read-only snapshot from history.
				<button v-if="isOwner" class="rb-action" @click="handleSetLocked(false)">Allow editing</button>
			</div>
			<div v-else-if="archived" class="readonly-banner readonly-banner--saved">
				Editable Archive — In history but unlocked. Lock to make read-only.
				<button v-if="isOwner" class="rb-action" @click="handleSetLocked(true)">Lock now</button>
			</div>
			<div v-else-if="readOnly" class="readonly-banner">
				View Only — You can see this board but cannot make changes.
			</div>

			<!-- Board area -->
			<div
				ref="boardRef"
				class="wb-board"
				@mousemove="handleMouseMove"
				@mouseleave="handleMouseLeave"
			>
				<!-- Drawing canvas (strokes) -->
				<DrawingCanvas
					:strokes="strokes"
					:active-tool="readOnly ? 'select' : activeTool"
					:pen-color="penColor"
					:pen-width="penWidth"
					@stroke-complete="handleStrokeComplete"
					@stroke-erase="handleStrokeErase"
				/>

				<!-- Shapes -->
				<ShapeElement
					v-for="shape in shapes"
					:key="shape.id"
					:shape="shape"
					:is-select-mode="activeTool === 'select' && !readOnly"
					@update="handleShapeUpdate(shape.id, $event)"
					@delete="handleShapeDelete(shape.id)"
				/>

				<!-- Sticky notes -->
				<StickyNote
					v-for="sticky in stickies"
					:key="sticky.id"
					:sticky="sticky"
					:is-select-mode="activeTool === 'select' && !readOnly"
					@update="handleStickyUpdate(sticky.id, $event)"
					@delete="handleStickyDelete(sticky.id)"
					@vote="handleStickyVote(sticky.id, $event)"
				/>

				<!-- Cursor overlay (remote users) -->
				<CursorOverlay :awareness="awareness" />

				<!-- Settings panel (owner only) -->
				<WhiteboardSettings
					v-if="showSettings && isOwner"
					:doc-title="docTitle"
					:access="access"
					:is-owner="true"
					:current-members="docMembers"
					:archived="archived"
					:locked="locked"
					@update="handleSettingsUpdate"
					@archive="handleArchive"
					@set-locked="handleSetLocked"
					@close="showSettings = false"
				/>

				<!-- History panel -->
				<WhiteboardHistory
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
.whiteboard-overlay {
	display: flex;
	flex-direction: column;
	background: #f8fafc;
	border-radius: 12px;
	overflow: hidden;
	box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
	z-index: 600;
}

.whiteboard-overlay.maximized {
	position: fixed;
	top: 20px;
	left: 20px;
	right: 20px;
	bottom: calc(3.25rem + 20px);
}

.whiteboard-overlay.floating {
	position: fixed;
	top: 60px;
	right: 20px;
	width: 700px;
	height: 500px;
	max-height: calc(100vh - 3.25rem - 80px);
	resize: both;
}

.wb-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 8px 12px;
	background: #1e293b;
	color: #f8fafc;
	flex-shrink: 0;
	user-select: none;
}

.wb-header-left {
	display: flex;
	align-items: center;
	gap: 10px;
}

.wb-title {
	font-weight: 600;
	font-size: 14px;
}

.wb-role {
	font-size: 11px;
	padding: 2px 8px;
	border-radius: 4px;
	font-weight: 500;
}
.wb-role.owner { background: #f59e0b; color: #1e293b; }
.wb-role.editor { background: #3b82f6; color: #fff; }
.wb-role.viewer { background: #64748b; color: #fff; }
.wb-role.archived { background: #7c3aed; color: #fff; }

.wb-status {
	font-size: 11px;
	padding: 2px 6px;
	border-radius: 4px;
}
.wb-status.synced { background: #16a34a; }
.wb-status.connecting { background: #ca8a04; }

.wb-header-right {
	display: flex;
	gap: 4px;
}

.wb-btn {
	background: none;
	border: none;
	color: #f8fafc;
	font-size: 16px;
	cursor: pointer;
	padding: 4px 8px;
	border-radius: 4px;
	line-height: 1;
}
.wb-btn:hover { background: rgba(255, 255, 255, 0.1); }
.close-btn:hover { background: #dc2626; }

.wb-board {
	flex: 1;
	position: relative;
	overflow: hidden;
	cursor: crosshair;
}

.readonly-banner {
	display: flex; align-items: center; justify-content: center; gap: 0.5rem;
	padding: 0.375rem 0.75rem;
	background: #fef3c7;
	color: #92400e;
	font-size: 0.75rem;
	text-align: center;
	font-weight: 500;
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

/* Denied state */
.wb-denied {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	padding: 60px 40px;
	text-align: center;
	flex: 1;
}

.denied-icon { font-size: 48px; margin-bottom: 16px; }
.denied-title { font-size: 18px; font-weight: 700; color: #1e293b; margin: 0 0 8px; }
.denied-desc { font-size: 14px; color: #64748b; margin: 0 0 24px; }
.denied-close {
	padding: 8px 20px;
	border: none;
	border-radius: 6px;
	background: #1e293b;
	color: #fff;
	font-size: 13px;
	cursor: pointer;
}
.denied-close:hover { background: #334155; }
</style>
