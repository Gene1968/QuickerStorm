<script setup>
/**
 * ProfileFloater — Firestorm-style profile dialog.
 * Self mode: bio editable. Other mode: read-only except Notes; action buttons shown.
 * Controlled by uiStore.showProfile + uiStore.profileTargetId.
 */
import { ref, computed, watch } from 'vue'
import { useUiStore }       from '@/stores/uiStore.js'
import { useAvatarStore }   from '@/stores/avatarStore.js'
import { usePresenceStore } from '@/stores/presenceStore.js'
import { useSessionStore }  from '@/stores/sessionStore.js'
import FloaterWindow        from '@/components/FloaterWindow.vue'

const ui       = useUiStore()
const avatar   = useAvatarStore()
const presence = usePresenceStore()
const session  = useSessionStore()

// ── Computed ─────────────────────────────────────────────────────────────────
const isSelf = computed(() => ui.profileTargetId === null)

const displayName = computed(() =>
	isSelf.value ? avatar.displayName : '(Other User)'
)

// WHY: agentId from sessionStore is the live grid-assigned UUID (most authoritative for self)
const profileUUID = computed(() =>
	isSelf.value ? (session.agentId ?? avatar.authUserId ?? '—') : (ui.profileTargetId ?? '—')
)

const onlineStatus = computed(() => {
	if (isSelf.value) return null
	const user = presence.users.find(u => u.id === ui.profileTargetId)
	return user?.status ?? 'offline'
})

// ── Tabs ─────────────────────────────────────────────────────────────────────
const TABS = [
	{ id: 'profile',    label: 'Profile',   soon: false },
	{ id: 'interests',  label: 'Interests', soon: true  },
	{ id: 'picks',      label: 'Picks',     soon: true  },
	{ id: 'first_life', label: '1st Life',  soon: true  },
	{ id: 'notes',      label: 'Notes',     soon: false },
]

const activeTab = ref('profile')

function selectTab(tab) {
	if (tab.soon) return
	activeTab.value = tab.id
}

// ── Bio editing (self only) ───────────────────────────────────────────────────
const bioEdit  = ref('')
const bioDirty = computed(() => bioEdit.value !== avatar.bio)

watch(() => ui.showProfile, (open) => {
	if (open) { bioEdit.value = avatar.bio; activeTab.value = 'profile' }
}, { immediate: true })

async function saveBio()  { await avatar.setBio(bioEdit.value) }
function  discardBio()    { bioEdit.value = avatar.bio }

// ── Notes (localStorage, per-UUID) ───────────────────────────────────────────
const notes = ref('')

function notesKey() {
	const id = isSelf.value ? (avatar.authUserId ?? 'self') : ui.profileTargetId
	return `ava_profile_notes_${id}`
}

watch(
	[() => ui.showProfile, () => ui.profileTargetId],
	([open]) => { if (open) notes.value = localStorage.getItem(notesKey()) ?? '' },
	{ immediate: true }
)

function saveNotes() {
	try { localStorage.setItem(notesKey(), notes.value) } catch { /* ignore: private-mode */ }
}
</script>

<template>
	<FloaterWindow
		id="profile"
		title="Profile"
		:wrap-style="{ width: '30rem', height: '34rem', resize: 'both' }"
		:default-pos="{ left: '20%', top: '5%' }"
		@close="ui.showProfile = false"
	>
		<!-- Tab strip -->
		<div class="flex flex-row border-b border-brd shrink-0 px-2 pt-2 gap-0.5">
			<button
				v-for="tab in TABS"
				:key="tab.id"
				@click="selectTab(tab)"
				:class="[
					'relative px-3 py-1.5 text-xs font-medium rounded-t transition-colors',
					tab.soon
						? 'text-t1 cursor-default'
						: activeTab === tab.id
							? 'text-accent border-b-2 border-accent -mb-px bg-accent/10'
							: 'text-t1 hover:text-t1 hover:bg-white/5',
				]"
			>
				{{ tab.label }}
				<span v-if="tab.soon" class="absolute -top-1 -right-1 text-[9px] font-bold text-t1 leading-none">soon</span>
			</button>
		</div>

		<!-- Content -->
		<div class="flex-1 overflow-y-auto p-4">

			<!-- Profile tab -->
			<div v-if="activeTab === 'profile'" class="flex flex-col gap-3">

				<!-- Name + Key above photo -->
				<div>
					<p class="text-sm font-bold text-t1 truncate">{{ displayName }}</p>
					<p v-if="!isSelf" :class="onlineStatus === 'online' ? 'text-green-400 font-bold text-xs mt-0.5' : 'text-red-400 font-bold text-xs mt-0.5'">
						{{ onlineStatus === 'online' ? 'Online' : 'Offline' }}
					</p>
					<div class="flex items-baseline gap-2 mt-1">
						<span class="text-2xs text-t1 w-14 shrink-0">Key</span>
						<span class="text-2xs text-t1 font-mono select-all break-all">{{ profileUUID }}</span>
					</div>
				</div>

				<!-- Photo + remaining fields -->
				<div class="flex gap-4">
					<div class="w-28 h-28 shrink-0 rounded bg-white/10 border border-brd flex items-center justify-center text-4xl text-t1 select-none">👤</div>
					<div class="flex flex-col gap-1 pt-0.5">
						<div
							v-for="field in [
								{ label: 'Born',    value: 'N/A' },
								{ label: 'Account', value: 'Resident' },
								{ label: 'Partner', value: 'None' },
							]"
							:key="field.label"
							class="flex items-baseline gap-2"
						>
							<span class="text-2xs text-t1 w-14 shrink-0">{{ field.label }}</span>
							<span class="text-2xs text-t1 font-mono">{{ field.value }}</span>
						</div>
					</div>
				</div>

				<div>
					<p class="text-2xs text-t1 mb-1">Groups</p>
					<div class="rounded bg-white/5 border border-brd px-2 py-1.5 text-xs text-t1 italic min-h-[2rem]">(none)</div>
				</div>

				<div class="flex flex-col gap-1">
					<p class="text-2xs text-t1">About</p>
					<textarea
						v-if="isSelf"
						v-model="bioEdit"
						rows="5"
						placeholder="Write something about yourself…"
						class="w-full rounded bg-white/5 border border-brd px-2 py-1.5 text-xs text-t1 placehotext-t1 resize-none focus:outline-none focus:border-accent/60 transition-colors"
					/>
					<div v-else class="rounded bg-white/5 border border-brd px-2 py-1.5 text-xs text-t1 min-h-[5rem] whitespace-pre-wrap">(no about text)</div>
				</div>

				<div v-if="isSelf && bioDirty" class="flex justify-end gap-2 mt-1">
					<button @click="discardBio" class="px-3 py-1 text-xs rounded border border-brd text-t1 hover:text-t1 hover:bg-white/5 transition-colors">Discard</button>
					<button @click="saveBio"    class="px-3 py-1 text-xs rounded bg-accent text-white hover:bg-accent/80 transition-colors">Save</button>
				</div>
			</div>

			<!-- Notes tab -->
			<div v-else-if="activeTab === 'notes'" class="flex flex-col gap-2 h-full">
				<p class="text-2xs text-t1 shrink-0">Private notes — only visible to you</p>
				<textarea
					v-model="notes"
					@input="saveNotes"
					rows="14"
					placeholder="Notes about this person…"
					class="w-full flex-1 rounded bg-white/5 border border-brd px-2 py-1.5 text-xs text-t1 placehotext-t1 resize-none focus:outline-none focus:border-accent/60 transition-colors"
				/>
			</div>

			<!-- Coming soon -->
			<div v-else class="flex flex-col items-center justify-center h-40 gap-2">
				<span class="text-2xl text-t1">🚧</span>
				<p class="text-sm text-t1">Coming soon</p>
			</div>
		</div>

		<!-- Other-user action buttons (all disabled Phase 1) -->
		<div v-if="!isSelf" class="shrink-0 border-t border-brd px-4 py-2 flex gap-2 flex-wrap">
			<button
				v-for="btn in ['IM', 'Pay', 'Block', 'Find on Map', 'Offer TP', 'Remove Friend']"
				:key="btn"
				disabled
				class="px-2.5 py-1 text-xs rounded border border-brd text-t1 cursor-not-allowed opacity-50"
			>{{ btn }}</button>
		</div>
	</FloaterWindow>
</template>
