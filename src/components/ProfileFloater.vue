<script setup>
/**
 * ProfileFloater — Firestorm-style profile dialog.
 * Self mode: bio editable. Other mode: read-only except Notes; action buttons shown.
 * Multi-instance: one floater per open target. `targetId` prop = null (self) or a UUID.
 * Mounted via v-for over uiStore.profileInstances; closed via uiStore.closeProfile(targetId).
 */
import { ref, computed, watch, onMounted } from 'vue'
import { useUiStore }       from '@/stores/uiStore.js'
import { useAvatarStore }   from '@/stores/avatarStore.js'
import { usePresenceStore } from '@/stores/presenceStore.js'
import { useSessionStore }  from '@/stores/sessionStore.js'
import { useGridSocialStore } from '@/stores/gridSocialStore.js'
import { useSocial }        from '@/composables/useSocial.js'
import { useInstantMessage } from '@/composables/useInstantMessage.js'
import FloaterWindow        from '@/components/FloaterWindow.vue'

const props = defineProps({
	// null = self profile; UUID string = another user's profile
	targetId: { type: String, default: null },
	// open-order index — staggers the default position so stacked profiles stay legible
	index:    { type: Number, default: 0 },
})

const ui       = useUiStore()
const avatar   = useAvatarStore()
const presence = usePresenceStore()
const session  = useSessionStore()
const social   = useGridSocialStore()
const { requestProfile, requestNames, offerFriendship, removeFriend } = useSocial()
const im       = useInstantMessage()

// ── Computed ─────────────────────────────────────────────────────────────────
const isSelf = computed(() => props.targetId === null)

// Resolved profile fragment for the current target (other users only).
const profile = computed(() => isSelf.value ? null : social.profileFor(props.targetId))
const avProps = computed(() => profile.value?.properties ?? null)

const displayName = computed(() => {
	if (isSelf.value) return avatar.displayName
	return social.nameFor(props.targetId) || '(Other User)'
})

// WHY: agentId from sessionStore is the live grid-assigned UUID (most authoritative for self)
const profileUUID = computed(() =>
	isSelf.value ? (session.agentId ?? avatar.authUserId ?? '—') : (props.targetId ?? '—')
)

// WHY: grid online status — prefer the friend's live OnlineNotification flag, fall back to
// web-collab presence for users who are in-scene but not grid friends.
const onlineStatus = computed(() => {
	if (isSelf.value) return null
	const friend = social.friendById(props.targetId)
	if (friend) return friend.online ? 'online' : 'offline'
	const user = presence.users.find(u => u.id === props.targetId)
	return user?.status ?? 'offline'
})

const isFriend = computed(() => !isSelf.value && social.isFriend(props.targetId))

// ── Profile field values ───────────────────────────────────────────────────
const bornValue    = computed(() => avProps.value?.bornOn || 'N/A')
const partnerValue = computed(() => {
	const pid = avProps.value?.partnerId
	if (!pid || pid === '00000000-0000-0000-0000-000000000000') return 'None'
	return social.nameFor(pid) || `${pid.slice(0, 8)}…`
})
const aboutValue   = computed(() => avProps.value?.aboutText || '')
// Groups shown: self → my group list; other → their AvatarGroupsReply groups.
const shownGroups  = computed(() => isSelf.value ? social.groups : (profile.value?.groups ?? []))

// ── Tabs ─────────────────────────────────────────────────────────────────────
const TABS = [
	{ id: 'profile',    label: 'Profile',   soon: false },
	{ id: 'interests',  label: 'Interests', soon: false },
	{ id: 'picks',      label: 'Picks',     soon: true  },
	{ id: 'first_life', label: '1st Life',  soon: true  },
	{ id: 'notes',      label: 'Notes',     soon: false },
]

const activeTab = ref('profile')

function selectTab(tab) {
	if (tab.soon) return
	activeTab.value = tab.id
}

// ── Fetch profile data on open (mounted fresh per target) ────────────────────
onMounted(() => {
	if (!isSelf.value && props.targetId) {
		requestProfile(props.targetId)   // → AvatarProperties/Interests/Groups replies
		requestNames([props.targetId])   // resolve their display name
	}
	// Self bio + notes init (other-user notes loaded below too)
	if (isSelf.value) bioEdit.value = avatar.bio
	activeTab.value = 'profile'
	notes.value = localStorage.getItem(notesKey()) ?? ''
})
// Resolve partner name once properties arrive.
watch(() => avProps.value?.partnerId, (pid) => {
	if (pid && pid !== '00000000-0000-0000-0000-000000000000') requestNames([pid])
})

// ── Actions (gated — change the real grid account) ──────────────────────────
function actIM() {
	if (isSelf.value) return
	im.openWith(props.targetId, displayName.value)
	ui.showChat = true
}
function actOfferFriend() {
	if (isSelf.value) return
	if (window.confirm(`Offer friendship to ${displayName.value}?`)) {
		offerFriendship(props.targetId, displayName.value)
	}
}
function actRemoveFriend() {
	if (isSelf.value) return
	if (window.confirm(`Remove ${displayName.value} from your friends? This cannot be undone.`)) {
		removeFriend(props.targetId)
	}
}

// ── Bio editing (self only) ───────────────────────────────────────────────────
const bioEdit  = ref('')
const bioDirty = computed(() => bioEdit.value !== avatar.bio)

async function saveBio()  { await avatar.setBio(bioEdit.value) }
function  discardBio()    { bioEdit.value = avatar.bio }

// ── Notes (localStorage, per-UUID) ───────────────────────────────────────────
const notes = ref('')

function notesKey() {
	const id = isSelf.value ? (avatar.authUserId ?? 'self') : props.targetId
	return `ava_profile_notes_${id}`
}

function saveNotes() {
	try { localStorage.setItem(notesKey(), notes.value) } catch { /* ignore: private-mode */ }
}
</script>

<template>
	<FloaterWindow
		:id="`profile-${targetId ?? 'self'}`"
		:title="isSelf ? 'My Profile' : `Profile — ${displayName}`"
		:wrap-style="{ width: '30rem', height: '34rem', resize: 'both' }"
		:default-pos="{ left: `calc(20% + ${index * 1.5}rem)`, top: `calc(5% + ${index * 1.5}rem)` }"
		@close="ui.closeProfile(targetId)"
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
				<span v-if="tab.soon" class="absolute -top-1 -right-1 text-2xs font-bold text-t1 leading-none">soon</span>
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
					<div class="w-28 h-28 shrink-0 rounded bg-white/10 border border-brd flex items-center justify-center text-t1 select-none overflow-hidden" title="default profile image"><span class="text-8xl -mt-1">👤</span></div>
					<div class="flex flex-col gap-1 pt-0.5">
						<div
							v-for="field in [
								{ label: 'Born',    value: bornValue },
								{ label: 'Account', value: 'Resident' },
								{ label: 'Partner', value: partnerValue },
							]"
							:key="field.label"
							class="flex items-baseline gap-2"
						>
							<span class="text-2xs text-t1 w-14 shrink-0">{{ field.label }}</span>
							<span class="text-2xs text-t1 font-mono">{{ field.value }}</span>
						</div>
						<div v-if="isSelf && social.groupTitle" class="flex items-baseline gap-2">
							<span class="text-2xs text-t1 w-14 shrink-0">Title</span>
							<span class="text-2xs text-accent font-mono">{{ social.groupTitle }}</span>
						</div>
					</div>
				</div>

				<div>
					<p class="text-2xs text-t1 mb-1">Groups:</p>
					<div class="rounded bg-white/5 border border-brd px-2 py-1.5 text-xs min-h-[2rem]">
						<div v-if="shownGroups.length === 0" class="text-t1 italic">(none)</div>
						<ul v-else class="flex flex-col gap-0.5">
							<li
								v-for="g in shownGroups"
								:key="g.id"
								class="text-t1 truncate"
								:class="isSelf && g.id === social.activeGroupId ? 'text-accent font-semibold' : ''"
								:title="g.title || g.name"
							>{{ g.name }}</li>
						</ul>
					</div>
				</div>

				<div class="flex flex-col gap-1">
					<p class="text-2xs text-t1">About:</p>
					<textarea
						v-if="isSelf"
						v-model="bioEdit"
						rows="5"
						placeholder="Write something about yourself…"
						class="w-full rounded bg-white/5 border border-brd px-2 py-1.5 text-xs text-t1 placehotext-t1 resize-none focus:outline-none focus:border-accent/60 transition-colors"
					/>
					<div v-else class="rounded bg-white/5 border border-brd px-2 py-1.5 text-xs text-t1 min-h-[5rem] whitespace-pre-wrap">{{ aboutValue || '(no about text)' }}</div>
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

			<!-- Interests tab -->
			<div v-else-if="activeTab === 'interests'" class="flex flex-col gap-3">
				<div v-if="isSelf" class="text-xs text-t1 italic">Interests shown here come from the grid profile.</div>
				<div class="flex flex-col gap-1">
					<p class="text-2xs text-t1">Wants to</p>
					<div class="rounded bg-white/5 border border-brd px-2 py-1.5 text-xs text-t1 min-h-[2rem] whitespace-pre-wrap">{{ profile?.interests?.wantToText || '—' }}</div>
				</div>
				<div class="flex flex-col gap-1">
					<p class="text-2xs text-t1">Skills</p>
					<div class="rounded bg-white/5 border border-brd px-2 py-1.5 text-xs text-t1 min-h-[2rem] whitespace-pre-wrap">{{ profile?.interests?.skillsText || '—' }}</div>
				</div>
				<div class="flex flex-col gap-1">
					<p class="text-2xs text-t1">Languages</p>
					<div class="rounded bg-white/5 border border-brd px-2 py-1.5 text-xs text-t1 min-h-[2rem] whitespace-pre-wrap">{{ profile?.interests?.languagesText || '—' }}</div>
				</div>
			</div>

			<!-- Coming soon -->
			<div v-else class="flex flex-col items-center justify-center h-40 gap-2">
				<span class="text-2xl text-t1">🚧</span>
				<p class="text-sm text-t1">Coming soon</p>
			</div>
		</div>

		<div class="flex flex-col gap-1 px-4 py-2">
			<p class="text-2xs text-t1">Share:</p>
				<button
					disabled
					class="px-2.5 py-1 text-xs rounded border border-brd text-t1 cursor-not-allowed opacity-50"
				>Drop inventory item here.</button>
		</div>

			<!-- Other-user action buttons -->
		<div v-if="!isSelf" class="flex flex-row flex-wrap gap-2 shrink-0 border-t border-brd px-4 py-2">
			<button
				class="flex-1 whitespace-nowrap px-2.5 py-1 text-xs rounded border border-brd text-t1 hover:bg-white/5 transition-colors"
				@click="actIM"
			>Instant Message</button>
			<button
				v-if="!isFriend"
				class="flex-1 whitespace-nowrap px-2.5 py-1 text-xs rounded border border-accent/60 text-accent hover:bg-accent/10 transition-colors"
				@click="actOfferFriend"
			>Add Friend</button>
			<button
				v-else
				class="flex-1 whitespace-nowrap px-2.5 py-1 text-xs rounded border border-brd text-red-400 hover:bg-red-500/10 transition-colors"
				@click="actRemoveFriend"
			>Remove Friend</button>
			<!-- Still gated on extra packets (Phase 3 later): Pay, Block, Find on Map, Offer TP -->
			<button
				v-for="btn in ['Find on Map', 'Offer Teleport','Pay', 'Block']"
				:key="btn"
				disabled
				class="flex-1 whitespace-nowrap px-2.5 py-1 text-xs rounded border border-brd text-t1 cursor-not-allowed opacity-50"
			>{{ btn }}</button>
		</div>
	</FloaterWindow>
</template>
