<script setup>
/**
 * TaskBoardSettings — Owner settings panel for a task board.
 * Mirrors CollabDocSettings with task board terminology.
 */
import { ref, computed } from 'vue'
import { usePresenceStore } from '@/stores/presenceStore.js'
import { useAvatarStore } from '@/stores/avatarStore.js'
import { avaConfirm } from '@/composables/useConfirm.js'

const props = defineProps({
	docTitle:       { type: String,  default: '' },
	access:         { type: String,  default: 'public' },
	isOwner:        { type: Boolean, default: false },
	currentMembers: { type: Array,   default: () => [] },
	archived:       { type: Boolean, default: false },
	locked:         { type: Boolean, default: true },
})

const emit = defineEmits(['update', 'archive', 'save', 'set-locked', 'close'])

const presenceStore = usePresenceStore()
const avatarStore = useAvatarStore()

const editTitle = ref(props.docTitle)
const editAccess = ref(props.access)

const members = ref(
	props.currentMembers
		.filter(m => m.userId !== avatarStore.authUserId)
		.map(m => {
			const user = presenceStore.users.find(u => u.authUserId === m.userId)
			return { userId: m.userId, role: m.role, name: user?.name || user?.email || 'User' }
		})
)

const myAuthId = computed(() => avatarStore.authUserId)
const availableUsers = computed(() => {
	return presenceStore.users
		.filter(u => {
			const uid = u.authUserId || u.id
			return uid && uid !== myAuthId.value && !members.value.find(m => m.userId === uid)
		})
		.map(u => ({ userId: u.authUserId || u.id, name: u.name || u.email || 'User' }))
})

function addMember(user) {
	if (members.value.find(m => m.userId === user.userId)) return
	members.value.push({ userId: user.userId, role: 'editor', name: user.name })
}
function removeMember(userId) { members.value = members.value.filter(m => m.userId !== userId) }
function setMemberRole(userId, role) {
	const m = members.value.find(m => m.userId === userId)
	if (m) m.role = role
}

function handleSave() {
	emit('update', {
		title: editTitle.value,
		access: editAccess.value,
		members: members.value.map(m => ({ userId: m.userId, role: m.role })),
	})
}

async function handleArchive() {
	const ok = await avaConfirm({
		title: 'Archive Task Board',
		message: 'Archive this board? It will be locked in history (read-only). A new board can be created afterward.',
		confirmLabel: 'Archive',
	})
	if (ok) emit('archive')
}

async function handleSnapshot() {
	const ok = await avaConfirm({
		title: 'Save Snapshot',
		message: 'Save this board to history while keeping it editable? You can re-open it from history and continue working.',
		confirmLabel: 'Save',
	})
	if (ok) emit('save')
}
</script>

<template>
	<div class="settings-panel">
		<div class="settings-header">
			<h3>Board Settings</h3>
			<button class="close-btn" @click="emit('close')">✕</button>
		</div>
		<div class="settings-body">
			<label class="field-label">Title</label>
			<input v-model="editTitle" class="field-input" maxlength="60" />

			<label class="field-label">Access</label>
			<div class="access-toggle">
				<button class="toggle-btn" :class="{ active: editAccess === 'public' }" @click="editAccess = 'public'">Public</button>
				<button class="toggle-btn" :class="{ active: editAccess === 'private' }" @click="editAccess = 'private'">Private</button>
			</div>

			<template v-if="editAccess === 'private'">
				<label class="field-label">Members</label>
				<div class="member-row owner-row">
					<span class="member-name">{{ avatarStore.displayName || 'You' }}</span>
					<span class="owner-badge">Owner</span>
				</div>
				<div v-for="m in members" :key="m.userId" class="member-row">
					<span class="member-name">{{ m.name }}</span>
					<select :value="m.role" @change="setMemberRole(m.userId, $event.target.value)" class="role-select">
						<option value="owner">Owner</option>
						<option value="editor">Editor</option>
						<option value="viewer">Viewer</option>
					</select>
					<button class="remove-btn" @click="removeMember(m.userId)" title="Remove">✕</button>
				</div>
				<div class="user-picker" v-if="availableUsers.length">
					<label class="field-label">Add Members</label>
					<div class="user-grid">
						<button v-for="user in availableUsers" :key="user.userId" class="user-chip" @click="addMember(user)">
							+ {{ user.name }}
						</button>
					</div>
				</div>
			</template>

			<button class="btn-primary save-btn" @click="handleSave">Save Changes</button>

			<hr class="divider" />

			<!-- Active board: Save (snapshot but editable) / Archive (snapshot + lock) -->
			<template v-if="!archived">
				<button class="btn-secondary action-btn" @click="handleSnapshot">📥 Save snapshot</button>
				<p class="hint">Stores a copy in history. Members can reopen and continue editing.</p>
				<button class="btn-danger action-btn" @click="handleArchive">🔒 Archive (lock)</button>
				<p class="hint">Stores a copy in history as read-only. The board will be cleared for everyone.</p>
			</template>

			<!-- Archived + locked: owner can re-enable editing -->
			<template v-else-if="locked">
				<button class="btn-secondary action-btn" @click="emit('set-locked', false)">🔓 Allow editing</button>
				<p class="hint">Unlocks this archived board so members can edit it again.</p>
			</template>

			<!-- Archived + unlocked (saved): owner can re-lock -->
			<template v-else>
				<button class="btn-danger action-btn" @click="emit('set-locked', true)">🔒 Lock (read-only)</button>
				<p class="hint">Locks this saved snapshot so it becomes read-only.</p>
			</template>
		</div>
	</div>
</template>

<style scoped>
.settings-panel { position: absolute; top: 0; right: 0; width: 320px; height: 100%; background: #fff; border-left: 1px solid #e2e8f0; box-shadow: -4px 0 12px rgba(0, 0, 0, 0.08); z-index: 600; display: flex; flex-direction: column; }
.settings-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid #e2e8f0; }
.settings-header h3 { font-size: 15px; font-weight: 600; margin: 0; }
.close-btn { background: none; border: none; font-size: 16px; cursor: pointer; color: #64748b; padding: 4px; }
.settings-body { flex: 1; padding: 16px; overflow-y: auto; }
.field-label { display: block; font-size: 12px; font-weight: 600; color: #475569; margin: 14px 0 6px; }
.field-input { width: 100%; padding: 8px 10px; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 13px; }
.access-toggle { display: flex; border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden; }
.toggle-btn { flex: 1; padding: 6px; border: none; background: #f8fafc; font-size: 12px; cursor: pointer; color: #64748b; }
.toggle-btn.active { background: #3b82f6; color: #fff; }
.member-row { display: flex; align-items: center; gap: 6px; padding: 6px 10px; background: #f1f5f9; border-radius: 6px; margin-bottom: 4px; }
.owner-row { background: #fef3c7; }
.member-name { flex: 1; font-size: 12px; color: #1e293b; }
.owner-badge { font-size: 10px; padding: 2px 6px; border-radius: 4px; background: #f59e0b; color: #1e293b; font-weight: 600; }
.role-select { font-size: 11px; padding: 2px 4px; border: 1px solid #e2e8f0; border-radius: 3px; }
.remove-btn { background: none; border: none; cursor: pointer; color: #94a3b8; font-size: 12px; }
.remove-btn:hover { color: #ef4444; }
.user-picker { margin-top: 8px; }
.user-grid { display: flex; flex-wrap: wrap; gap: 4px; }
.user-chip { padding: 3px 8px; border: 1px solid #e2e8f0; border-radius: 12px; background: #fff; font-size: 11px; cursor: pointer; }
.user-chip:hover { border-color: #3b82f6; }
.save-btn { width: 100%; margin-top: 16px; }
.btn-primary { padding: 8px 16px; border: none; border-radius: 6px; background: #3b82f6; color: #fff; font-size: 13px; cursor: pointer; }
.btn-primary:hover { background: #2563eb; }
.divider { border: none; border-top: 1px solid #e2e8f0; margin: 16px 0; }
.btn-danger { width: 100%; padding: 8px 16px; border: 1px solid #fecaca; border-radius: 6px; background: #fff; color: #dc2626; font-size: 13px; cursor: pointer; }
.btn-danger:hover { background: #fef2f2; }
.btn-secondary { width: 100%; padding: 8px 16px; border: 1px solid #e2e8f0; border-radius: 6px; background: #fff; color: #475569; font-size: 13px; cursor: pointer; }
.btn-secondary:hover { background: #f8fafc; border-color: #94a3b8; }
.action-btn { margin-top: 4px; }
.action-btn + .hint { margin-bottom: 12px; }
.hint { font-size: 11px; color: #94a3b8; margin: 4px 0 0; }
</style>
