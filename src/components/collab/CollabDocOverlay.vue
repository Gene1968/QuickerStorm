<script setup>
/**
 * CollabDocOverlay — Full-screen collaborative markdown doc UI.
 * Mirrors WhiteboardOverlay's permission-state machine: denied / setup / normal+readonly.
 */
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useCollabDoc } from '@/composables/useCollabDoc.js'
import { useAvatarStore } from '@/stores/avatarStore.js'
import CollabDocEditor from './CollabDocEditor.vue'
import CollabDocSetup from './CollabDocSetup.vue'
import CollabDocSettings from './CollabDocSettings.vue'
import CollabDocHistory from './CollabDocHistory.vue'

const props = defineProps({
	docId:      { type: String, required: true },
	roomId:     { type: String, required: true },
	persistent: { type: Boolean, default: true },
})

const emit = defineEmits(['close'])

const avatarStore = useAvatarStore()

const {
	text,
	connected, synced, awareness,
	connect, disconnect,
	setText, applyTemplate, setCursor, clearCursor,
	role, access, isNew, denied, docTitle, docMembers, archived, locked, readOnly, isOwner,
	setupBoard, updatePermissions, archiveBoard, setLocked, listHistory,
} = useCollabDoc(props.docId, {
	roomId: props.roomId,
	persistent: props.persistent,
	title: `Doc - ${props.roomId}`,
})

const localUserName = computed(() => avatarStore.displayName || 'User')
const localUserColor = computed(() => avatarStore.color || '#3b82f6')

function onCursorChange(offset) {
	if (typeof offset !== 'number') return
	setCursor(offset, localUserName.value, localUserColor.value)
}
function onCursorLeave() { clearCursor() }

// ── UI State ────────────────────────────────────────────────────────────
const editMode = ref('split') // 'edit' | 'preview' | 'split'
const isMaximized = ref(true)
const showSettings = ref(false)
const showHistory = ref(false)
const historyDocs = ref([])
const historyLoading = ref(false)

// ── Lifecycle ───────────────────────────────────────────────────────────
onMounted(() => connect())
onUnmounted(() => disconnect())

// Auto-close after 3s if archived/access-revoked
watch(denied, (val) => {
	if (val && (val.reason === 'archived' || val.reason === 'access-revoked')) {
		setTimeout(() => handleClose(), 3000)
	}
})

// ── Setup flow ──────────────────────────────────────────────────────────
async function handleSetupComplete(config) {
	try {
		await setupBoard(config.title, config.access, config.members)
		// After setup completes, owner can apply the chosen template
		if (config.templateKey && config.templateKey !== 'blank') {
			applyTemplate(config.templateKey)
		}
	} catch (e) {
		console.error('[doc] setup failed:', e)
	}
}

// ── Settings + History ──────────────────────────────────────────────────
async function handleSettingsUpdate(config) {
	try {
		await updatePermissions(config.access, config.members, config.title)
		showSettings.value = false
	} catch (e) { console.error('[doc] update permissions failed:', e) }
}

async function handleArchive() {
	try {
		await archiveBoard()
		emit('close')
	} catch (e) { console.error('[doc] archive failed:', e) }
}

async function handleSetLocked(next) {
	try { await setLocked(next) }
	catch (e) { console.error('[doc] setLocked failed:', e) }
}

async function openHistory() {
	showSettings.value = false
	showHistory.value = true
	historyLoading.value = true
	try {
		const docs = await listHistory()
		historyDocs.value = (docs || []).filter(d => !d.type || d.type === 'doc')
	} catch (e) {
		console.error('[doc] list history failed:', e)
		historyDocs.value = []
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

function onEditorUpdate(next) { setText(next) }
</script>

<template>
	<div class="doc-overlay" :class="{ maximized: isMaximized, floating: !isMaximized }">
		<!-- DENIED -->
		<template v-if="denied">
			<div class="doc-denied">
				<div class="denied-icon">🔒</div>
				<h3 class="denied-title">Doc is Private</h3>
				<p class="denied-desc" v-if="denied.reason === 'no-access'">You don't have access to this doc.</p>
				<p class="denied-desc" v-else-if="denied.reason === 'archived'">This doc has been archived.</p>
				<p class="denied-desc" v-else-if="denied.reason === 'access-revoked'">Your access has been revoked.</p>
				<p class="denied-desc" v-else>Access denied.</p>
				<button class="denied-close" @click="handleClose">Close</button>
			</div>
		</template>

		<!-- SETUP (first open) -->
		<template v-else-if="isNew">
			<div class="doc-header">
				<div class="doc-header-left">
					<span class="doc-title">New Document</span>
				</div>
				<div class="doc-header-right">
					<button class="doc-btn close-btn" @click="handleClose" title="Close">✕</button>
				</div>
			</div>
			<CollabDocSetup @setup="handleSetupComplete" @close="handleClose" />
		</template>

		<!-- NORMAL / READ-ONLY -->
		<template v-else>
			<div class="doc-header">
				<div class="doc-header-left">
					<span class="doc-title">{{ docTitle || 'Document' }}</span>
					<span v-if="archived" class="doc-role archived">Archived</span>
					<span v-else-if="role" class="doc-role" :class="role">
						{{ role === 'owner' ? 'Owner' : role === 'editor' ? 'Editor' : 'View Only' }}
					</span>
					<span v-if="synced" class="doc-status synced">synced</span>
					<span v-else-if="connected" class="doc-status connecting">connecting...</span>
				</div>
				<div class="doc-header-right">
					<!-- Mode toggle -->
					<div class="mode-toggle">
						<button class="mode-btn" :class="{ active: editMode === 'edit' }" @click="editMode = 'edit'" title="Edit">✎</button>
						<button class="mode-btn" :class="{ active: editMode === 'split' }" @click="editMode = 'split'" title="Split">⊟</button>
						<button class="mode-btn" :class="{ active: editMode === 'preview' }" @click="editMode = 'preview'" title="Preview">👁</button>
					</div>

					<button v-if="isOwner" class="doc-btn" @click="showHistory = false; showSettings = !showSettings" title="Settings">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
						</svg>
					</button>
					<button class="doc-btn" @click="openHistory" title="Doc History">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
						</svg>
					</button>
					<button class="doc-btn" @click="toggleMaximize" :title="isMaximized ? 'Minimize' : 'Maximize'">
						<span v-if="isMaximized">⊡</span>
						<span v-else>⊞</span>
					</button>
					<button class="doc-btn close-btn" @click="handleClose" title="Close">✕</button>
				</div>
			</div>

			<div v-if="archived && locked" class="readonly-banner readonly-banner--locked">
				Archived Doc — Read-only snapshot from history.
				<button v-if="isOwner" class="rb-action" @click="handleSetLocked(false)">Allow editing</button>
			</div>
			<div v-else-if="archived" class="readonly-banner readonly-banner--saved">
				Editable Archive — In history but unlocked. Lock to make read-only.
				<button v-if="isOwner" class="rb-action" @click="handleSetLocked(true)">Lock now</button>
			</div>
			<div v-else-if="readOnly" class="readonly-banner">
				View Only — You can read this doc but cannot make changes.
			</div>

			<div class="doc-body">
				<CollabDocEditor
					:text="text"
					:read-only="readOnly"
					:mode="editMode"
					:awareness="awareness"
					:local-user-name="localUserName"
					:local-user-color="localUserColor"
					@update:text="onEditorUpdate"
					@cursor="onCursorChange"
					@cursor-leave="onCursorLeave"
				/>

				<CollabDocSettings
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

				<CollabDocHistory
					v-if="showHistory"
					:docs="historyDocs"
					:loading="historyLoading"
					@open="handleHistoryOpen"
					@close="showHistory = false"
				/>
			</div>
		</template>
	</div>
</template>

<style scoped>
.doc-overlay {
	display: flex;
	flex-direction: column;
	background: #fff;
	border-radius: 12px;
	overflow: hidden;
	box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
	z-index: 600;
}

.doc-overlay.maximized {
	position: fixed;
	top: 20px; left: 20px; right: 20px;
	bottom: calc(3.25rem + 20px);
}

.doc-overlay.floating {
	position: fixed;
	top: 60px; right: 20px;
	width: 760px; height: 540px;
	max-height: calc(100vh - 3.25rem - 80px);
	resize: both;
}

.doc-header {
	display: flex; align-items: center; justify-content: space-between;
	padding: 8px 12px;
	background: #1e293b; color: #f8fafc;
	flex-shrink: 0; user-select: none;
}

.doc-header-left { display: flex; align-items: center; gap: 10px; }
.doc-title { font-weight: 600; font-size: 14px; }

.doc-role {
	font-size: 11px; padding: 2px 8px; border-radius: 4px; font-weight: 500;
}
.doc-role.owner    { background: #f59e0b; color: #1e293b; }
.doc-role.editor   { background: #3b82f6; color: #fff; }
.doc-role.viewer   { background: #64748b; color: #fff; }
.doc-role.archived { background: #7c3aed; color: #fff; }

.doc-status { font-size: 11px; padding: 2px 6px; border-radius: 4px; }
.doc-status.synced { background: #16a34a; }
.doc-status.connecting { background: #ca8a04; }

.doc-header-right { display: flex; align-items: center; gap: 4px; }

.mode-toggle {
	display: flex;
	background: rgba(255, 255, 255, 0.08);
	border-radius: 4px;
	margin-right: 4px;
}
.mode-btn {
	background: none; border: none; color: #cbd5e1;
	font-size: 13px; padding: 4px 8px; cursor: pointer; line-height: 1;
}
.mode-btn:hover { color: #fff; }
.mode-btn.active { background: #3b82f6; color: #fff; border-radius: 4px; }

.doc-btn {
	background: none; border: none; color: #f8fafc;
	font-size: 16px; cursor: pointer; padding: 4px 8px; border-radius: 4px; line-height: 1;
}
.doc-btn:hover { background: rgba(255, 255, 255, 0.1); }
.close-btn:hover { background: #dc2626; }

.doc-body {
	flex: 1;
	position: relative;
	display: flex;
	overflow: hidden;
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

.doc-denied {
	display: flex; flex-direction: column; align-items: center; justify-content: center;
	padding: 60px 40px; text-align: center; flex: 1;
}
.denied-icon { font-size: 48px; margin-bottom: 16px; }
.denied-title { font-size: 18px; font-weight: 700; color: #1e293b; margin: 0 0 8px; }
.denied-desc { font-size: 14px; color: #64748b; margin: 0 0 24px; }
.denied-close {
	padding: 8px 20px; border: none; border-radius: 6px;
	background: #1e293b; color: #fff; font-size: 13px; cursor: pointer;
}
.denied-close:hover { background: #334155; }
</style>
