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
import { useInventory }     from '@/composables/useInventory.js'
import { useInventoryStore } from '@/stores/inventoryStore.js'
import FloaterWindow        from '@/components/FloaterWindow.vue'
import { EyeIcon, MapPinSearchIcon, BoxIcon } from '@lucide/vue'

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
const invStore = useInventoryStore()
const { shareToAgent } = useInventory()

// Drop-zone state for the "give inventory" target (other-user profiles only).
const dropActive = ref(false)
// WHY: accept ANY inventory drag (items, folders, or a mixed selection) — shareToAgent routes items
// and folders to the right give path. dataTransfer.getData is unreadable during dragover, so read the
// shared inventoryStore.dragPayload set on dragstart.
function invDragGivable() { const p = invStore.dragPayload; return !!p && p.ids?.length > 0 }
function onGiveDragOver(e) {
	if (isSelf.value || !invDragGivable()) return
	e.preventDefault()
	e.dataTransfer.dropEffect = 'copy'
	dropActive.value = true
}
function onGiveDragLeave() { dropActive.value = false }
function onGiveDrop(e) {
	dropActive.value = false
	if (isSelf.value || !invDragGivable()) return
	e.preventDefault()
	const toId = props.targetId
	if (!toId) return
	shareToAgent(invStore.dragPayload.ids, toId, displayName.value)
	invStore.clearDrag()
}

// ── Computed ─────────────────────────────────────────────────────────────────
const isSelf = computed(() => props.targetId === null)

// Resolved profile fragment — self uses live agentId once session is ready.
const profileId = computed(() =>
	isSelf.value ? (session.agentId ?? null) : props.targetId
)
const profile = computed(() => {
	const id = profileId.value
	return id ? social.profileFor(id) : null
})
const avProps = computed(() => profile.value?.properties ?? null)

const displayName = computed(() => {
	if (isSelf.value) return avatar.displayName
	return social.nameFor(props.targetId) || '(Other User)'
})

// WHY: agentId from sessionStore is the live grid-assigned UUID (most authoritative for self)
const profileUUID = computed(() =>
	isSelf.value ? (session.agentId ?? '—') : (props.targetId ?? '—')
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
const BORN_DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/

function parseBornWithAge(bornOn) {
	const raw = (bornOn ?? '').trim()
	if (!raw) return { date: 'N/A', age: null }

	const match = BORN_DATE_RE.exec(raw)
	if (!match) return { date: raw, age: null }

	const month = Number(match[1])
	const day = Number(match[2])
	const year = Number(match[3])
	const birth = new Date(year, month - 1, day)
	if (birth.getFullYear() !== year || birth.getMonth() !== month - 1 || birth.getDate() !== day) {
		return { date: raw, age: null }
	}

	const today = new Date()
	const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())
	if (birth > todayStart) return { date: raw, age: null }

	const totalDays = Math.floor((todayStart - birth) / 86_400_000)

	let years = today.getFullYear() - year
	let months = today.getMonth() - (month - 1)
	if (today.getDate() < day) {
		months--
		if (months < 0) {
			years--
			months += 12
		}
	} else if (months < 0) {
		years--
		months += 12
	}

	const date = `${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}/${year}`
	const age = `(${years} years ${months} months; ${totalDays} days)`
	return { date, age }
}

const bornDisplay = computed(() => parseBornWithAge(avProps.value?.bornOn))
const partnerValue = computed(() => {
	const pid = avProps.value?.partnerId
	if (!pid || pid === '00000000-0000-0000-0000-000000000000') return 'None'
	return social.nameFor(pid) || `${pid.slice(0, 8)}…`
})
const profileDetailFields = computed(() => [
	{ label: 'Account: ', value: 'Resident' },
	{ label: 'Partner: ', value: partnerValue.value },
])
const aboutValue   = computed(() => avProps.value?.aboutText || '')
// Groups shown: self → my group list; other → their AvatarGroupsReply groups.
const shownGroups  = computed(() => isSelf.value ? social.groups : (profile.value?.groups ?? []))

// ── Tabs ─────────────────────────────────────────────────────────────────────
const TABS = [
	{ id: 'profile',    label: 'Profile',   soon: false },
	{ id: 'feed',    label: 'Feed',   soon: false },
	{ id: 'picks',      label: 'Picks',     soon: true  },
	{ id: 'classifieds',  label: 'Classifieds', soon: false },
	{ id: 'first_life', label: '1st Life',  soon: true  },
	{ id: 'notes',      label: 'Notes',     soon: false },
]

const activeTab = ref('profile')

function selectTab(tab) {
	if (tab.soon) return
	activeTab.value = tab.id
}

// ── Fetch profile data on open (mounted fresh per target) ────────────────────
function loadProfileData() {
	const id = profileId.value
	if (!id) return
	requestProfile(id)
	if (!isSelf.value) requestNames([id])
}

onMounted(() => {
	loadProfileData()
	// Self bio + notes init (other-user notes loaded below too)
	if (isSelf.value) bioEdit.value = avatar.bio
	activeTab.value = 'profile'
	notes.value = localStorage.getItem(notesKey()) ?? ''
})
watch(profileId, (id) => { if (id) loadProfileData() })
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
	const id = isSelf.value ? (session.agentId ?? 'self') : props.targetId
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
		:wrap-style="{ width: '28rem', height: '36rem', resize: 'both' }"
		:default-pos="{ left: `calc(20% + ${index * 1.5}rem)`, top: `calc(5% + ${index * 1.5}rem)` }"
		@close="ui.closeProfile(targetId)"
	>
		<!-- Tab strip -->
		<div class="flex flex-row border-b border-edge shrink-0 px-2 pt-2 gap-0.5">
			<button
				v-for="tab in TABS"
				:key="tab.id"
				@click="selectTab(tab)"
				:class="[
					'relative px-3 py-1.5 text-xs font-medium rounded-t transition-colors',
					tab.soon
						? 'text-fg cursor-default'
						: activeTab === tab.id
							? 'text-accent border-b-2 border-accent -mb-px bg-accent/10'
							: 'text-fg hover:text-fg hover:bg-white/5',
				]"
			>
				{{ tab.label }}
				<span v-if="tab.soon" class="absolute -top-1 -right-1 text-2xs font-bold text-fg leading-none">soon</span>
			</button>
		</div>

		<!-- Content -->
		<div class="flex-1 overflow-y-auto p-4">

			<!-- Profile tab -->
			<div v-if="activeTab === 'profile'" class="flex flex-col gap-3">

				<!-- Name + Key above photo -->
				<div>
					<div class="flex items-center justify-between gap-4">
						<p class="border border-edge rounded-sm bg-white/5 w-full p-1 px-2 text-sm font-bold text-fg truncate">{{ displayName || 'loading...' }}</p>
						<div class="flex items-center gap-3">
							<EyeIcon title="Friend can see my online status" class="w-5 h-5 text-fg" />
							<MapPinSearchIcon title="Friend can see me on map" class="w-5 h-5 text-fg" />
							<BoxIcon title="Friend can edit my objects" class="w-5 h-5 text-fg" />
						</div>
					</div>
					<div class="flex items-baseline justify-between gap-2 mt-1">
						<div>
							<span class="inline-block shrink-0 w-10 me-4 text-end text-2xs text-fg">Key: </span>
							<span class="text-xs text-fg font-mono select-all break-all">{{ profileUUID }}</span>
						</div>
						<p v-if="!isSelf" :class="onlineStatus === 'online' ? 'text-green-400 font-bold text-xs mt-0.5' : 'text-red-400 font-bold text-xs mt-0.5'">
							{{ onlineStatus === 'online' ? 'Online' : 'Offline' }}
						</p>
					</div>
				</div>

				<!-- Photo + remaining fields -->
				<div class="flex gap-4">
					<div class="w-28 h-28 shrink-0 rounded-sm bg-white/10 border border-edge flex items-center justify-center text-fg select-none overflow-hidden" title="default profile image">
						<span title="default/unknown profile image" class="text-8xl mt-2">👤</span>
						<!-- else real image here -->
					</div>
					<div class="flex flex-col gap-1 pt-0.5 min-w-0">
						<div class="flex items-baseline gap-2">
							<span class="text-end text-2xs text-fg w-14 shrink-0">Birthdate: </span>
							<div class="border border-edge rounded-sm bg-white/5 p-1 px-2 text-2xs text-fg font-mono break-words min-w-0 flex flex-col">
								<span>{{ bornDisplay.date }}</span>
								<span v-if="bornDisplay.age">{{ bornDisplay.age }}</span>
							</div>
						</div>
						<div
							v-for="field in profileDetailFields"
							:key="field.label"
							class="flex items-baseline gap-2"
						>
							<span class="text-end text-2xs text-fg w-14 shrink-0">{{ field.label }}</span>
							<span class="border border-edge rounded-sm bg-white/5 p-1 px-2 text-2xs text-fg font-mono">{{ field.value }}</span>
						</div>
						<div v-if="isSelf && social.groupTitle" class="flex items-baseline gap-2">
							<span class="text-2xs text-fg w-14 shrink-0">Title</span>
							<span class="text-2xs text-accent font-mono">{{ social.groupTitle }}</span>
						</div>
					</div>
				</div>

				<div class="flex flex-col gap-1">
					<p class="text-2xs text-fg">About:</p>
					<textarea
						v-if="isSelf"
						v-model="bioEdit"
						rows="4"
						placeholder="Write something about yourself…"
						class="w-full rounded-sm bg-white/5 border border-edge px-2 py-1.5 text-xs text-fg placeholder:text-fg-subtle resize-none focus:outline-hidden focus:border-accent/60 transition-colors"
					/>
					<div v-else class="rounded bg-white/5 border border-edge px-2 py-1.5 text-xs text-fg min-h-[5rem] whitespace-pre-wrap">{{ aboutValue || '(no about text)' }}</div>
				</div>

				<div v-if="isSelf && bioDirty" class="flex justify-end gap-2 mt-1">
					<button @click="discardBio" class="px-3 py-1 text-xs rounded-sm border border-edge text-fg hover:text-fg hover:bg-white/5 transition-colors">Discard</button>
					<button @click="saveBio"    class="px-3 py-1 text-xs rounded-sm bg-accent text-white hover:bg-accent/80 transition-colors">Save</button>
				</div>

				<div>
					<p class="text-2xs text-fg mb-1">Groups:</p>
					<div class="border border-edge rounded-sm bg-white/5 px-2 py-1.5 text-xs min-h-[2rem]">
						<div v-if="shownGroups.length === 0" class="text-fg italic">(none)</div>
						<ul v-else class="flex flex-col gap-0.5">
							<li
								v-for="g in shownGroups"
								:key="g.id"
								class="text-fg truncate"
								:class="isSelf && g.id === social.activeGroupId ? 'text-accent font-semibold' : ''"
								:title="g.title || g.name"
							>{{ g.name }}</li>
						</ul>
					</div>
				</div>

				<!-- <div class="flex flex-col gap-1">
					<p class="text-2xs text-fg">Wants to</p>
					<div class="rounded bg-white/5 border border-edge px-2 py-1.5 text-xs text-fg min-h-[2rem] whitespace-pre-wrap">{{ profile?.interests?.wantToText || '—' }}</div>
				</div>
				<div class="flex flex-col gap-1">
					<p class="text-2xs text-fg">Skills</p>
					<div class="rounded bg-white/5 border border-edge px-2 py-1.5 text-xs text-fg min-h-[2rem] whitespace-pre-wrap">{{ profile?.interests?.skillsText || '—' }}</div>
				</div>
				<div class="flex flex-col gap-1">
					<p class="text-2xs text-fg">Languages</p>
					<div class="rounded bg-white/5 border border-edge px-2 py-1.5 text-xs text-fg min-h-[2rem] whitespace-pre-wrap">{{ profile?.interests?.languagesText || '—' }}</div>
				</div> -->

			</div>

			<!-- Feed tab -->
			<div v-else-if="activeTab === 'feed'" class="flex flex-col gap-3">
				<div v-if="isSelf" class="text-xs text-fg italic">Feed (to-do)</div>
			</div>

			<!-- Picks tab -->
			<div v-else-if="activeTab === 'picks'" class="flex flex-col gap-3">
				<div v-if="isSelf" class="text-xs text-fg italic">Picks (to-do)</div>
			</div>

			<!-- Classifieds tab -->
			<div v-else-if="activeTab === 'classifieds'" class="flex flex-col gap-3">
				<div v-if="isSelf" class="text-xs text-fg italic">This person has no Classifieds (to-do)</div>
			</div>

			<!-- 1st Life tab -->
			<div v-else-if="activeTab === 'first_life'" class="flex flex-col gap-3">
				<div v-if="isSelf" class="text-xs text-fg italic">1st Life (to-do)</div>
			</div>

			<!-- Notes tab -->
			<div v-else-if="activeTab === 'notes'" class="flex flex-col gap-2 h-full">
				<p class="text-2xs text-fg shrink-0">Private notes — only visible to you</p>
				<textarea
					v-model="notes"
					@input="saveNotes"
					rows="14"
					placeholder="Notes about this person…"
					class="w-full flex-1 rounded-sm bg-white/5 border border-edge px-2 py-1.5 text-xs text-fg placeholder:text-fg-subtle resize-none focus:outline-hidden focus:border-accent/60 transition-colors"
				/>
			</div>

			<!-- Coming soon -->
			<div v-else class="flex flex-col items-center justify-center h-40 gap-2">
				<span class="text-2xl text-fg">🚧</span>
				<p class="text-sm text-fg">Coming soon</p>
			</div>
		</div>

		<div class="flex flex-col gap-1 px-4 py-2">
			<p class="text-2xs text-fg">Share:</p>
			<!-- Self can't give to self → stays a disabled hint. Other-user profiles are a live drop
			     target: drag inventory item(s) here to offer them to this avatar. -->
			<button
				v-if="isSelf"
				disabled
				class="px-2.5 py-1 text-xs rounded-sm border border-edge text-fg cursor-not-allowed opacity-50"
			>Drop inventory item here.</button>
			<div
				v-else
				class="px-2.5 py-2 text-xs text-center rounded-sm border border-dashed transition-colors"
				:class="dropActive ? 'border-accent bg-accent/10 text-accent' : 'border-edge text-fg'"
				@dragover="onGiveDragOver"
				@dragleave="onGiveDragLeave"
				@drop="onGiveDrop"
			>Drop inventory item here to give to {{ displayName }}.</div>
		</div>

			<!-- Other-user action buttons -->
		<div v-if="!isSelf" class="flex flex-row flex-wrap gap-1 shrink-0 border-t border-edge px-4 py-2">
			<!-- Still gated on extra packets (Phase 3 later): Pay, Block, Find on Map, Offer TP -->
			<button
				v-for="btn in ['Find on Map', 'Offer Teleport','Pay', 'Block']"
				:key="btn"
				disabled
				class="ui-btn whitespace-nowrap flex-1 min-w-[32%] px-2.5 py-1 text-xs rounded-sm border border-edge text-fg cursor-not-allowed opacity-50"
			>{{ btn }}</button>
			<button
				v-if="!isFriend"
				class="ui-btn whitespace-nowrap flex-1 min-w-[32%] px-2.5 py-1 text-xs rounded-sm border border-accent/60 text-accent hover:bg-accent/10 transition-colors"
				@click="actOfferFriend"
			>Add Friend</button>
			<button
				v-else
				class="ui-btn whitespace-nowrap flex-1 min-w-[32%] px-2.5 py-1 text-xs rounded-sm border border-edge text-red-400 hover:bg-red-500/10 transition-colors"
				@click="actRemoveFriend"
			>Remove Friend</button>
			<button
				class="ui-btn whitespace-nowrap flex-1 min-w-[32%] px-2.5 py-1 text-xs rounded-sm border border-edge text-fg hover:bg-white/5 transition-colors"
				@click="actIM"
			>Instant Message</button>
		</div>
	</FloaterWindow>
</template>
