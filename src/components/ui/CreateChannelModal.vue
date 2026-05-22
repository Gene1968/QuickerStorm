<script setup>
/**
 * CreateChannelModal — form for creating a new channel (public or private).
 * Optionally invite users at creation time.
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

const channelName  = ref('')
const description  = ref('')
const isPrivate    = ref(false)
const search       = ref('')
const invited      = ref([])        // array of user objects
const creating     = ref(false)
const error        = ref('')

// Sanitised channel name: lowercase, hyphens instead of spaces, no special chars
const sanitisedName = computed(() =>
	channelName.value
		.toLowerCase()
		.replace(/\s+/g, '-')
		.replace(/[^a-z0-9-]/g, '')
		.slice(0, 60),
)

// Filter users: exclude self, dev users, match search
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
	const idx = invited.value.findIndex(u => u.id === user.id)
	if (idx >= 0) {
		invited.value = invited.value.filter((_, i) => i !== idx)
	} else {
		invited.value = [...invited.value, user]
	}
}

function isInvited(user) {
	return invited.value.some(u => u.id === user.id)
}

function initials(name) {
	if (!name) return '??'
	const parts = name.trim().split(' ').filter(Boolean)
	if (parts.length >= 2) return (parts[0][0] + parts.at(-1)[0]).toUpperCase()
	return name.slice(0, 2).toUpperCase() || '??'
}

async function create() {
	if (!sanitisedName.value || creating.value) return
	creating.value = true
	error.value = ''
	try {
		await messaging.createChannel(
			sanitisedName.value,
			description.value.trim() || null,
			isPrivate.value,
			invited.value,
		)
		emit('close')
	} catch (e) {
		error.value = e.message || 'Failed to create channel'
	} finally {
		creating.value = false
	}
}
</script>

<template>
	<Teleport to="body">
		<div class="ncm-backdrop" @click="$emit('close')">
			<div class="ncm-modal ccm-modal" @click.stop>
				<div class="ncm-header">
					<span class="ncm-title">Create Channel</span>
					<button class="ncm-close" @click="$emit('close')">&#10005;</button>
				</div>

				<!-- Channel name -->
				<div class="ncm-search-wrap">
					<div class="ccm-name-row">
						<span class="ccm-hash">{{ isPrivate ? '&#128274;' : '#' }}</span>
						<input
							class="ncm-search ccm-name-input"
							v-model="channelName"
							placeholder="channel-name"
							autofocus
							maxlength="60"
						/>
					</div>
					<div v-if="channelName && sanitisedName !== channelName" class="ccm-name-preview">
						Will be created as: <strong>#{{ sanitisedName }}</strong>
					</div>
				</div>

				<!-- Description -->
				<div class="ncm-search-wrap">
					<input
						class="ncm-search"
						v-model="description"
						placeholder="Description (optional)"
						maxlength="200"
					/>
				</div>

				<!-- Public / Private toggle -->
				<div class="ccm-toggle-row">
					<button
						class="ccm-toggle-btn"
						:class="{ active: !isPrivate }"
						@click="isPrivate = false"
					>Public</button>
					<button
						class="ccm-toggle-btn"
						:class="{ active: isPrivate }"
						@click="isPrivate = true"
					>Private</button>
					<span class="ccm-toggle-hint">
						{{ isPrivate ? 'Only invited members can see this channel' : 'Anyone on the team can join' }}
					</span>
				</div>

				<!-- Invite members (optional) -->
				<div class="ccm-invite-label">Invite members (optional)</div>
				<div class="ncm-search-wrap">
					<input
						class="ncm-search"
						v-model="search"
						placeholder="Search users..."
					/>
				</div>

				<!-- Selected chips -->
				<div v-if="invited.length" class="ncm-chips">
					<span
						v-for="u in invited"
						:key="u.id"
						class="ncm-chip"
						@click="toggleUser(u)"
					>
						{{ u.name?.split(' ')[0] || '?' }} &#10005;
					</span>
				</div>

				<!-- User list -->
				<div class="ncm-list ccm-list">
					<div
						v-for="user in filteredUsers"
						:key="user.id"
						class="ncm-user"
						:class="{ 'ncm-user--selected': isInvited(user) }"
						@click="toggleUser(user)"
					>
						<div class="ncm-bubble" :style="{ background: user.color }">
							{{ initials(user.name) }}
						</div>
						<div class="ncm-info">
							<div class="ncm-name">{{ user.name }}</div>
							<div class="ncm-email">{{ user.email }}</div>
						</div>
						<span v-if="isInvited(user)" class="ncm-check">&#10003;</span>
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
						:disabled="!sanitisedName || creating"
						@click="create"
					>
						{{ creating ? '...' : 'Create Channel' }}
					</button>
				</div>
			</div>
		</div>
	</Teleport>
</template>

<style scoped>
/* Reuse NCM base styles from NewConversationModal; only add channel-specific styles */
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
	max-height: 80vh;
	background: var(--color-card);
	border: 1px solid var(--color-brd2);
	border-radius: 0.75rem;
	box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
	display: flex;
	flex-direction: column;
	overflow: hidden;
}
.ccm-modal {
	width: 24rem;
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
.ncm-search-wrap { padding: 0.5rem 0.75rem 0; }
.ncm-search {
	width: 100%;
	background: rgba(0, 0, 0, 0.2);
	border: 1px solid var(--color-brd);
	border-radius: 0.375rem;
	color: var(--color-t1);
	font-size: 0.8125rem;
	padding: 0.375rem 0.625rem;
	box-sizing: border-box;
}
.ncm-search:focus { outline: none; border-color: var(--color-accent3); }
.ncm-search::placeholder { color: var(--color-tm); opacity: 0.7; }

.ccm-name-row {
	display: flex;
	align-items: center;
	gap: 0.375rem;
}
.ccm-hash {
	font-size: 1rem;
	font-weight: 700;
	color: var(--color-tm);
	flex-shrink: 0;
	width: 1.25rem;
	text-align: center;
}
.ccm-name-input {
	flex: 1;
}
.ccm-name-preview {
	font-size: 0.625rem;
	color: var(--color-tm);
	padding: 0.25rem 0 0 1.625rem;
}

.ccm-toggle-row {
	display: flex;
	align-items: center;
	gap: 0.375rem;
	padding: 0.5rem 0.75rem;
	flex-wrap: wrap;
}
.ccm-toggle-btn {
	background: rgba(0, 0, 0, 0.15);
	border: 1px solid var(--color-brd);
	color: var(--color-tm);
	font-size: 0.6875rem;
	font-weight: 600;
	padding: 0.25rem 0.625rem;
	border-radius: 0.3125rem;
	cursor: pointer;
	transition: background 0.12s, color 0.12s, border-color 0.12s;
}
.ccm-toggle-btn.active {
	background: rgba(0, 180, 216, 0.2);
	color: var(--color-accent3);
	border-color: var(--color-accent3);
}
.ccm-toggle-hint {
	font-size: 0.5625rem;
	color: var(--color-tm);
	width: 100%;
}

.ccm-invite-label {
	font-size: 0.625rem;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.06em;
	color: var(--color-tm);
	padding: 0.375rem 0.75rem 0;
}

.ncm-chips {
	display: flex;
	flex-wrap: wrap;
	gap: 0.25rem;
	padding: 0.375rem 0.75rem 0;
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
.ncm-list {
	flex: 1;
	overflow-y: auto;
	padding: 0.25rem 0;
	min-height: 4rem;
	max-height: 20vh;
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
html.light .ccm-toggle-btn { background: rgba(0, 0, 0, 0.05); }
</style>
