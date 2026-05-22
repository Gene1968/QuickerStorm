<script setup>
/**
 * CollabDocSetup — First-open modal for configuring a new collaborative doc.
 * Mirrors WhiteboardSetup but adds a template picker (blank, standup, retro, etc.).
 */
import { ref, computed } from 'vue'
import { usePresenceStore } from '@/stores/presenceStore.js'
import { useAvatarStore } from '@/stores/avatarStore.js'
import { DOC_TEMPLATES } from '@/composables/useCollabDoc.js'

const emit = defineEmits(['setup', 'close'])

const presenceStore = usePresenceStore()
const avatarStore = useAvatarStore()

const docTitle = ref('Untitled Doc')
const docAccess = ref('public')
const templateKey = ref('blank')
const selectedMembers = ref([])

const myAuthId = computed(() => avatarStore.authUserId)
const availableUsers = computed(() => {
	return presenceStore.users
		.filter(u => {
			const uid = u.authUserId || u.id
			return uid && uid !== myAuthId.value && !selectedMembers.value.find(m => m.userId === uid)
		})
		.map(u => ({ userId: u.authUserId || u.id, name: u.name || u.email || 'User' }))
})

const templates = computed(() => Object.entries(DOC_TEMPLATES).map(([k, v]) => ({ key: k, label: v.label })))

function addMember(user) {
	if (selectedMembers.value.find(m => m.userId === user.userId)) return
	selectedMembers.value.push({ userId: user.userId, role: 'editor', name: user.name })
}
function removeMember(userId) { selectedMembers.value = selectedMembers.value.filter(m => m.userId !== userId) }
function setMemberRole(userId, role) {
	const m = selectedMembers.value.find(m => m.userId === userId)
	if (m) m.role = role
}

function handleSubmit() {
	emit('setup', {
		title: docTitle.value,
		access: docAccess.value,
		templateKey: templateKey.value,
		members: selectedMembers.value.map(m => ({ userId: m.userId, role: m.role })),
	})
}
</script>

<template>
	<div class="setup-backdrop">
		<div class="setup-modal">
			<h2 class="setup-title">Set Up Document</h2>
			<p class="setup-desc">Configure your shared doc. You'll be the owner.</p>

			<label class="field-label">Title</label>
			<input v-model="docTitle" class="field-input" placeholder="e.g. Sprint 12 Retro" maxlength="60" />

			<label class="field-label">Template</label>
			<div class="template-grid">
				<button
					v-for="t in templates"
					:key="t.key"
					class="template-chip"
					:class="{ active: templateKey === t.key }"
					@click="templateKey = t.key"
				>
					{{ t.label }}
				</button>
			</div>

			<label class="field-label">Access</label>
			<div class="access-toggle">
				<button class="toggle-btn" :class="{ active: docAccess === 'public' }" @click="docAccess = 'public'">Public</button>
				<button class="toggle-btn" :class="{ active: docAccess === 'private' }" @click="docAccess = 'private'">Private</button>
			</div>
			<p class="access-hint" v-if="docAccess === 'public'">Everyone can view and edit.</p>
			<p class="access-hint" v-else>Only invited members can access.</p>

			<template v-if="docAccess === 'private'">
				<label class="field-label">Members</label>
				<div class="member-list">
					<div class="member-row owner-row">
						<span class="member-name">{{ avatarStore.displayName || 'You' }}</span>
						<span class="owner-badge">Owner</span>
					</div>
					<div v-for="m in selectedMembers" :key="m.userId" class="member-row">
						<span class="member-name">{{ m.name }}</span>
						<select :value="m.role" @change="setMemberRole(m.userId, $event.target.value)" class="role-select">
							<option value="owner">Owner</option>
							<option value="editor">Editor</option>
							<option value="viewer">Viewer</option>
						</select>
						<button class="remove-btn" @click="removeMember(m.userId)">✕</button>
					</div>
				</div>
				<div class="user-picker">
					<label class="field-label">Add Members</label>
					<div class="user-grid" v-if="availableUsers.length">
						<button
							v-for="user in availableUsers"
							:key="user.userId"
							class="user-chip"
							@click="addMember(user)"
						>
							+ {{ user.name }}
						</button>
					</div>
					<p v-else class="no-users">No other users available.</p>
				</div>
			</template>

			<div class="setup-actions">
				<button class="btn-secondary" @click="emit('close')">Cancel</button>
				<button class="btn-primary" @click="handleSubmit">Create Doc</button>
			</div>
		</div>
	</div>
</template>

<style scoped>
.setup-backdrop {
	position: absolute;
	inset: 0;
	top: 2.5rem;
	background: rgba(15, 23, 42, 0.6);
	display: flex; align-items: center; justify-content: center;
	z-index: 100;
}
.setup-modal {
	background: #fff; border-radius: 12px; padding: 28px;
	width: 460px; max-height: 85vh; overflow-y: auto;
	box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
}
.setup-title { font-size: 18px; font-weight: 700; color: #1e293b; margin: 0 0 4px; }
.setup-desc { font-size: 13px; color: #64748b; margin: 0 0 20px; }
.field-label { display: block; font-size: 12px; font-weight: 600; color: #475569; margin: 16px 0 6px; }
.field-input {
	width: 100%; padding: 8px 12px;
	border: 1px solid #e2e8f0; border-radius: 6px;
	font-size: 14px; outline: none;
}
.field-input:focus { border-color: #3b82f6; }
.template-grid { display: flex; flex-wrap: wrap; gap: 6px; }
.template-chip {
	padding: 6px 12px;
	border: 1px solid #e2e8f0;
	border-radius: 16px;
	background: #fff;
	font-size: 12px;
	cursor: pointer;
	color: #475569;
}
.template-chip:hover { border-color: #3b82f6; }
.template-chip.active {
	border-color: #3b82f6;
	background: #3b82f6;
	color: #fff;
}
.access-toggle {
	display: flex;
	border: 1px solid #e2e8f0;
	border-radius: 6px;
	overflow: hidden;
}
.toggle-btn {
	flex: 1; padding: 8px 16px; border: none;
	background: #f8fafc; font-size: 13px; cursor: pointer; color: #64748b;
}
.toggle-btn.active { background: #3b82f6; color: #fff; }
.access-hint { font-size: 12px; color: #94a3b8; margin: 6px 0 0; }
.member-list { display: flex; flex-direction: column; gap: 6px; }
.member-row {
	display: flex; align-items: center; gap: 8px;
	padding: 6px 10px; background: #f1f5f9; border-radius: 6px;
}
.owner-row { background: #fef3c7; }
.member-name { flex: 1; font-size: 13px; color: #1e293b; }
.owner-badge {
	font-size: 11px; padding: 2px 8px; border-radius: 4px;
	background: #f59e0b; color: #1e293b; font-weight: 600;
}
.role-select { font-size: 12px; padding: 2px 6px; border: 1px solid #e2e8f0; border-radius: 4px; background: #fff; }
.remove-btn { background: none; border: none; color: #94a3b8; cursor: pointer; font-size: 14px; }
.remove-btn:hover { color: #ef4444; }
.user-picker { margin-top: 12px; }
.user-grid { display: flex; flex-wrap: wrap; gap: 6px; }
.user-chip {
	padding: 4px 10px; border: 1px solid #e2e8f0; border-radius: 14px;
	background: #fff; font-size: 12px; cursor: pointer; color: #334155;
}
.user-chip:hover { border-color: #3b82f6; }
.no-users { font-size: 12px; color: #94a3b8; }
.setup-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 24px; }
.btn-secondary {
	padding: 8px 16px; border: 1px solid #e2e8f0; border-radius: 6px;
	background: #fff; font-size: 13px; cursor: pointer; color: #475569;
}
.btn-secondary:hover { background: #f8fafc; }
.btn-primary {
	padding: 8px 16px; border: none; border-radius: 6px;
	background: #3b82f6; color: #fff; font-size: 13px; font-weight: 500; cursor: pointer;
}
.btn-primary:hover { background: #2563eb; }
</style>
