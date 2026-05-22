<script setup>
/**
 * NewConversationModal — user picker for starting a DM or group conversation.
 * Select one user for a DM; select multiple for a group chat.
 */
import { ref, computed } from 'vue'
import { usePresenceStore } from '@/stores/presenceStore.js'
import { useAvatarStore } from '@/stores/avatarStore.js'
import { useModalAudio } from '@/composables/useModalAudio.js'
useModalAudio()
import { useMessaging } from '@/composables/useMessaging.js'

const emit = defineEmits(['close'])

const presenceStore = usePresenceStore()
const avatarStore   = useAvatarStore()
const messaging     = useMessaging()

const search   = ref('')
const selected = ref([])        // array of user objects
const groupTitle = ref('')
const creating = ref(false)
const error    = ref('')

const isGroup = computed(() => selected.value.length > 1)

// Filter users: exclude self, dev users, and match search term
const filteredUsers = computed(() => {
	const q = search.value.toLowerCase().trim()
	return presenceStore.users
		.filter(u => {
			if (!u.authUserId) return false
			if (u.authUserId === avatarStore.authUserId) return false
			if (u.email?.includes('@localhost')) return false
			if (q && !u.name?.toLowerCase().includes(q) && !u.email?.toLowerCase().includes(q)) return false
			return true
		})
		.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
})

function toggleUser(user) {
	const idx = selected.value.findIndex(u => u.id === user.id)
	if (idx >= 0) {
		selected.value = selected.value.filter((_, i) => i !== idx)
	} else {
		selected.value = [...selected.value, user]
	}
}

function isSelected(user) {
	return selected.value.some(u => u.id === user.id)
}

function initials(name) {
	if (!name) return '??'
	const parts = name.trim().split(' ').filter(Boolean)
	if (parts.length >= 2) return (parts[0][0] + parts.at(-1)[0]).toUpperCase()
	return name.slice(0, 2).toUpperCase() || '??'
}

async function start() {
	if (!selected.value.length || creating.value) return
	creating.value = true
	error.value = ''
	try {
		if (isGroup.value) {
			await messaging.createGroupConversation(selected.value, groupTitle.value.trim() || null)
		} else {
			await messaging.openDmWithUser(selected.value[0])
		}
		emit('close')
	} catch (e) {
		error.value = e.message || 'Failed to create conversation'
	} finally {
		creating.value = false
	}
}
</script>

<template>
	<Teleport to="body">
		<div class="ncm-backdrop" @click="$emit('close')">
			<div class="ncm-modal" @click.stop>
				<div class="ncm-header">
					<span class="ncm-title">New Conversation</span>
					<button class="ncm-close" @click="$emit('close')">✕</button>
				</div>

				<!-- Search -->
				<div class="ncm-search-wrap">
					<input
						class="ncm-search"
						v-model="search"
						placeholder="Search users…"
						autofocus
					/>
				</div>

				<!-- Selected chips -->
				<div v-if="selected.length" class="ncm-chips">
					<span
						v-for="u in selected"
						:key="u.id"
						class="ncm-chip"
						@click="toggleUser(u)"
					>
						{{ u.name?.split(' ')[0] || '?' }} ✕
					</span>
				</div>

				<!-- Group title (when 2+ selected) -->
				<div v-if="isGroup" class="ncm-group-title-wrap">
					<input
						class="ncm-search"
						v-model="groupTitle"
						placeholder="Group name (optional)"
					/>
				</div>

				<!-- User list -->
				<div class="ncm-list">
					<div
						v-for="user in filteredUsers"
						:key="user.id"
						class="ncm-user"
						:class="{ 'ncm-user--selected': isSelected(user) }"
						@click="toggleUser(user)"
					>
						<div class="ncm-bubble" :style="{ background: user.color }">
							{{ initials(user.name) }}
						</div>
						<div class="ncm-info">
							<div class="ncm-name">{{ user.name }}</div>
							<div class="ncm-email">{{ user.email }}</div>
						</div>
						<span v-if="isSelected(user)" class="ncm-check">✓</span>
					</div>
					<div v-if="!filteredUsers.length" class="ncm-empty">
						No users found
					</div>
				</div>

				<!-- Error -->
				<div v-if="error" class="ncm-error">{{ error }}</div>

				<!-- Footer -->
				<div class="ncm-footer">
					<button class="ncm-cancel" @click="$emit('close')">Cancel</button>
					<button
						class="ncm-start"
						:disabled="!selected.length || creating"
						@click="start"
					>
						{{ creating ? '…' : isGroup ? 'Create Group' : 'Message' }}
					</button>
				</div>
			</div>
		</div>
	</Teleport>
</template>

<style scoped>
.ncm-backdrop {
	position: fixed;
	inset: 0;
	z-index: 400;
	background: rgba(0, 0, 0, 0.5);
	display: flex;
	align-items: center;
	justify-content: center;
}
.ncm-modal {
	width: 22rem;
	max-height: 70vh;
	background: var(--color-card);
	border: 1px solid var(--color-brd2);
	border-radius: 0.75rem;
	box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
	display: flex;
	flex-direction: column;
	overflow: hidden;
}
.ncm-header {
	display: flex;
	align-items: center;
	padding: 0.75rem 1rem;
	border-bottom: 1px solid var(--color-brd);
}
.ncm-title {
	flex: 1;
	font-size: 0.875rem;
	font-weight: 700;
	color: var(--color-t1);
}
.ncm-close {
	background: none;
	border: none;
	color: var(--color-tm);
	cursor: pointer;
	font-size: 0.75rem;
	padding: 0.25rem;
}
.ncm-search-wrap {
	padding: 0.5rem 0.75rem;
}
.ncm-search {
	width: 100%;
	background: rgba(0, 0, 0, 0.2);
	border: 1px solid var(--color-brd);
	border-radius: 0.375rem;
	color: var(--color-t1);
	font-size: 0.8125rem;
	padding: 0.375rem 0.625rem;
}
.ncm-search:focus { outline: none; border-color: var(--color-accent3); }
.ncm-search::placeholder { color: var(--color-tm); opacity: 0.7; }
.ncm-chips {
	display: flex;
	flex-wrap: wrap;
	gap: 0.25rem;
	padding: 0 0.75rem 0.375rem;
}
.ncm-chip {
	background: var(--color-accent3);
	color: #fff;
	font-size: 0.6875rem;
	font-weight: 600;
	padding: 0.125rem 0.5rem;
	border-radius: 1rem;
	cursor: pointer;
	transition: opacity 0.12s;
}
.ncm-chip:hover { opacity: 0.8; }
.ncm-group-title-wrap {
	padding: 0 0.75rem 0.375rem;
}
.ncm-list {
	flex: 1;
	overflow-y: auto;
	padding: 0.25rem 0;
	min-height: 8rem;
	max-height: 30vh;
	scrollbar-width: thin;
}
.ncm-user {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	padding: 0.375rem 0.75rem;
	cursor: pointer;
	transition: background 0.1s;
}
.ncm-user:hover { background: rgba(255, 255, 255, 0.04); }
.ncm-user--selected { background: rgba(255, 255, 255, 0.06); }
.ncm-bubble {
	width: 1.75rem;
	height: 1.75rem;
	border-radius: 50%;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 0.5rem;
	font-weight: 700;
	color: rgba(255, 255, 255, 0.9);
	flex-shrink: 0;
}
.ncm-info { flex: 1; min-width: 0; }
.ncm-name {
	font-size: 0.8125rem;
	font-weight: 600;
	color: var(--color-t1);
	line-height: 1.3;
}
.ncm-email {
	font-size: 0.625rem;
	color: var(--color-tm);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.ncm-check {
	color: var(--color-accent3);
	font-weight: 700;
	font-size: 0.875rem;
}
.ncm-empty {
	text-align: center;
	color: var(--color-tm);
	font-size: 0.75rem;
	padding: 1.5rem;
}
.ncm-error {
	font-size: 0.6875rem;
	color: var(--color-red);
	padding: 0.25rem 0.75rem;
}
.ncm-footer {
	display: flex;
	justify-content: flex-end;
	gap: 0.5rem;
	padding: 0.625rem 0.75rem;
	border-top: 1px solid var(--color-brd);
}
.ncm-cancel {
	background: none;
	border: 1px solid var(--color-brd);
	color: var(--color-tm);
	font-size: 0.75rem;
	padding: 0.375rem 0.75rem;
	border-radius: 0.375rem;
	cursor: pointer;
}
.ncm-start {
	background: var(--color-accent3);
	border: none;
	color: #fff;
	font-size: 0.75rem;
	font-weight: 600;
	padding: 0.375rem 1rem;
	border-radius: 0.375rem;
	cursor: pointer;
	transition: opacity 0.12s;
}
.ncm-start:disabled { opacity: 0.4; cursor: default; }

/* Light mode */
html.light .ncm-modal { box-shadow: 0 16px 48px rgba(0, 0, 0, 0.18); }
html.light .ncm-search { background: rgba(255, 255, 255, 0.6); }
html.light .ncm-user:hover { background: rgba(0, 0, 0, 0.04); }
html.light .ncm-user--selected { background: rgba(0, 0, 0, 0.06); }
</style>
