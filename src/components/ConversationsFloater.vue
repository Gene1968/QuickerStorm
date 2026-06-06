<script setup>
import { ref, computed, nextTick, watch } from 'vue'
import { useLocalChat }  from '@/composables/useLocalChat'
import { useInstantMessage } from '@/composables/useInstantMessage'
import { useAvatarStore } from '@/stores/avatarStore'
import { useUiStore }     from '@/stores/uiStore'
import { useGridSocialStore, hasRight, setRight, RIGHT_ONLINE, RIGHT_MAP, RIGHT_MODIFY } from '@/stores/gridSocialStore'
import { useSocial }     from '@/composables/useSocial'
import { playSound } from '@/composables/useAudio'
import { EyeIcon, MapPinSearchIcon, BoxIcon, ShieldUserIcon, HandshakeIcon, GiftIcon, PhoneIcon, CaptionsIcon, UserPlusIcon, SquareMenuIcon, SearchIcon, XIcon, MapIcon, ChevronDownIcon } from '@lucide/vue'
import FloaterWindow      from '@/components/FloaterWindow.vue'
import 'emoji-picker-element'

const avatar = useAvatarStore()
const ui     = useUiStore()
const social = useGridSocialStore()
const { removeFriend, setFriendRights, offerFriendship, findAvatars } = useSocial()
const { messages, send } = useLocalChat()
const im     = useInstantMessage()

// ── Contacts (grid friends) ──────────────────────────────────────────────
// WHY: friends come from the login buddy-list (gridSocialStore); names resolve via UUIDNameReply
// and online status via OnlineNotification — both handled session-wide by useSocial().
const contactSearch = ref('')
const sortedFriends = computed(() => {
	const q = contactSearch.value.trim().toLowerCase()
	const list = social.friends.filter(f => {
		if (!q) return true
		return (f.name || f.id).toLowerCase().includes(q)
	})
	// online first, then by name (fallback to UUID)
	return [...list].sort((a, b) => {
		if (a.online !== b.online) return a.online ? -1 : 1
		return (a.name || a.id).localeCompare(b.name || b.id)
	})
})
function friendLabel(f) { return f.name || `${f.id}` }
function openProfile(id) { ui.openProfile(id) }
function openIM(f)       { im.openWith(f.id, friendLabel(f)); activeTab.value = f.id }
function confirmRemove(f) {
	// WHY: TerminateFriendship changes the real grid account and can't be undone by us — confirm.
	if (window.confirm(`Remove ${friendLabel(f)} from your friends list? This cannot be undone.`)) {
		removeFriend(f.id)
	}
}

// ── Contacts: selection + rights + actions ────────────────────────────────
const selectedId = ref(null)
const selectedFriend = computed(() => social.friendById(selectedId.value))

function selectFriend(f) { selectedId.value = (selectedId.value === f.id) ? null : f.id }

// Toggle one of MY granted rights (online/map/modify) on a friend, then send to the sim.
function toggleRight(f, bit) {
	const next = setRight(f.rightsGiven, bit, !hasRight(f.rightsGiven, bit))
	social.setRightsGivenLocal(f.id, next) // optimistic; reconciled by S.FRIEND_RIGHTS_CHANGED
	setFriendRights(f.id, next)
}

// Action-bar enablement.
const canIM      = computed(() => !!selectedFriend.value)
const canProfile = computed(() => !!selectedFriend.value)
const canRemove  = computed(() => !!selectedFriend.value)
const canMap     = computed(() => !!selectedFriend.value && selectedFriend.value.online && hasRight(selectedFriend.value.rightsHas, RIGHT_MAP))
const canTeleport= computed(() => !!selectedFriend.value && selectedFriend.value.online)

function actIM()       { const f = selectedFriend.value; if (f) openIM(f) }
function actProfile()  { const f = selectedFriend.value; if (f) openProfile(f.id) }
function actRemove()   { const f = selectedFriend.value; if (f) confirmRemove(f) }
function actMap()      { const f = selectedFriend.value; if (f && canMap.value) { ui.profileTargetId = f.id; ui.showMap = true } }
function actTeleport() { const f = selectedFriend.value; if (f && canTeleport.value) openIM(f) }

// ── Add-Friend picker ──────────────────────────────────────────────────────
const showAdd     = ref(false)
const addQuery    = ref('')
const addResults  = ref([])
const addBusy     = ref(false)
function openAdd() { showAdd.value = true; addQuery.value = ''; addResults.value = [] }
async function runAddSearch() {
	const q = addQuery.value.trim()
	if (q.length < 2) return
	addBusy.value = true
	try { addResults.value = await findAvatars(q) }
	finally { addBusy.value = false }
}
function addFriendFromResult(r) {
	offerFriendship(r.id, r.name, 'Will you be my friend?')
	showAdd.value = false
}

const activeTab  = ref('nearby')
const chatInput  = ref('')
const imInput    = ref('')
const msgEl      = ref(null)
const imLogEl    = ref(null)
const inputEl    = ref(null)
const imInputEl  = ref(null)
const showEmoji  = ref(false)

// WHY: tabs derived from active IM conversations + fixed nearby/contacts.
// im.activeId switching is mirrored to activeTab so right-click → "IM" focuses correctly.
const tabs = computed(() => [
	{ id: 'contacts', label: 'Contacts', icon: '👥' },
	{ id: 'nearby',   label: 'Nearby Chat',   icon: '📡' },
	...[...im.conversations.value.values()].map(c => ({
		id: c.agentId, label: c.agentName, icon: '💬', closable: true,
	})),
])

const activeConv = computed(() => im.conversations.value.get(activeTab.value) ?? null)

watch(() => im.activeId.value, (id) => { if (id) activeTab.value = id })

// ── IM conversation action bar (FS-style, atop each IM tab) ────────────────
const imIsFriend = computed(() => {
	const c = activeConv.value
	return !!(c && social.isFriend(c.agentId))
})
const imMapEnabled = computed(() => {
	const c = activeConv.value
	if (!c) return false
	const f = social.friendById(c.agentId)
	return !!(f && f.online && hasRight(f.rightsHas, RIGHT_MAP))
})
function imProfile()   { const c = activeConv.value; if (c) openProfile(c.agentId) }
function imMap()       { const c = activeConv.value; if (c && imMapEnabled.value) { ui.profileTargetId = c.agentId; ui.showMap = true } }
function imAddFriend() { const c = activeConv.value; if (c) offerFriendship(c.agentId, c.agentName, 'Will you be my friend?') }
function imRemove()    { const c = activeConv.value; if (c) confirmRemove({ id: c.agentId, name: c.agentName }) }
function imCloseConv() { const c = activeConv.value; if (c) closeImTab(c.agentId) }

const floaterTitle = computed(() =>
	avatar.displayName ? `Conversations — ${avatar.displayName}` : 'Conversations'
)

const TYPE_CLASS = {
	0: 'text-white/50 italic',          // whisper
	1: 'text-t1',                        // normal
	2: 'text-yellow-400 font-semibold',  // shout
}

function formatTime(ts) {
	const d = new Date(ts)
	return `[${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}]`
}

function onInput() {
	if (chatInput.value.length === 1) playSound('typing.mp3', 0.3)
}

function onImInput() {
	if (imInput.value.length === 1) playSound('typing.mp3', 0.3)
}

async function selectTab(id) {
	activeTab.value = id
	im.setActive(id?.includes('-') ? id : null)
	await nextTick()
	if (id === 'nearby') inputEl.value?.focus()
	else if (activeConv.value) imInputEl.value?.focus()
}

function closeImTab(id, e) {
	e?.stopPropagation()
	im.close(id)
	if (activeTab.value === id) activeTab.value = 'nearby'
}

async function submitIM() {
	const text = imInput.value.trim()
	if (!text || !activeConv.value) return
	im.send(activeConv.value.agentId, text)
	imInput.value = ''
	await nextTick()
	if (imLogEl.value) imLogEl.value.scrollTop = 0
}

function focusInput() {
	inputEl.value?.focus()
}

function toggleEmoji(e) {
	e.stopPropagation()
	showEmoji.value = !showEmoji.value
}

function closeEmoji() {
	showEmoji.value = false
}

function onEmojiClick(e) {
	const emoji   = e.detail.unicode
	const isNearby = activeTab.value === 'nearby'
	const el      = isNearby ? inputEl.value : imInputEl.value
	if (el) {
		const model = isNearby ? chatInput : imInput
		const start = el.selectionStart ?? model.value.length
		const end   = el.selectionEnd   ?? model.value.length
		model.value = model.value.slice(0, start) + emoji + model.value.slice(end)
		nextTick(() => {
			const pos = start + [...emoji].length  // WHY: emoji may be multi-codepoint
			el.setSelectionRange(pos, pos)
			el.focus()
		})
	} else {
		const model = isNearby ? chatInput : imInput
		model.value += emoji
	}
	showEmoji.value = false
}

// Close picker on any outside click
watch(showEmoji, (val) => {
	if (val) setTimeout(() => document.addEventListener('click', closeEmoji, { once: true }), 0)
})

async function submitChat() {
	const msg = chatInput.value.trim()
	if (!msg) return
	send(msg)
	chatInput.value = ''
	await nextTick()
	if (msgEl.value) msgEl.value.scrollTop = 0
}

// TODO: persist position + size to indexedDB (too many floaters for localStorage)
// See docs/tech-debt.md
</script>

<template>
	<FloaterWindow
		id="conversations"
		:title="floaterTitle"
		:wrap-style="{ width: '33.75vw', height: '40vh', resize: 'both' }"
		:default-pos="{ left: '0.125%', top: '7%' }"
		@close="ui.toggleChat()"
	>
		<!-- ── Body: vertical tabs + content ─────────────────────── -->
		<div class="flex flex-1 min-h-0">

			<!-- Vertical tab strip -->
			<nav class="vtabs w-[11rem]">
				<div
					v-for="tab in tabs"
					:key="tab.id"
					class="relative group"
				>
					<button
						:class="activeTab === tab.id
							? 'active'
							: ''"
						@click="selectTab(tab.id)"
					>
						<span class="-mt-0.5 text-base leading-none">{{ tab.icon }}</span>
						<span :title="tab.label" class="w-full text-start leading-none truncate">{{ tab.label }}</span>
					</button>
					<button
						v-if="tab.closable"
						class="absolute block top-0 right-0.5 border opacity-20 hover:opacity-100"
						title="Close conversation"
						@click="closeImTab(tab.id, $event)"
					>
						<XIcon class="custom w-4 h-4 bg-red-900 text-white" />
					</button>
				</div>
			</nav>

			<!-- Content area -->
			<div class="flex flex-col flex-1 min-w-0 min-h-0">

				<!-- Contacts (Firestorm-style rights table) ─────────── -->
				<template v-if="activeTab === 'contacts'">
					<!-- To do: add tabs here for Friends, Groups and Contact Sets -->
					<!-- Begin Friends tab -->
					<div class="flex flex-row">
						<div class="flex-1 min-w-0">
							<div class="px-2 py-1.5 border-b border-brd shrink-0 flex items-center gap-4">
								<input
									v-model="contactSearch"
									type="text"
									placeholder="Filter friends"
									class="bg-brd2 rounded-xl w-full px-2 py-1 text-xs text-t1 placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent"
								/>
								<span class="text-xs text-t1 shrink-0">{{ social.onlineCount }} / {{ social.friendCount }} friends online</span>
							</div>
							<div v-if="social.friendCount === 0" class="flex-1 flex items-center justify-center text-gray-200 text-xs italic select-none">
								No friends on this account
							</div>
							<div v-else class="flex-1 overflow-y-auto min-h-0">
								<div class="flex items-center gap-1 px-2 py-1 text-2xs text-tm sticky top-0 bg-card border-b border-brd z-10 select-none">
									<span class="w-2 shrink-0"></span>
									<span class="flex-1 min-w-0 text-t1">Name</span>
									<EyeIcon title="Friend can see when you're online" class="w-5 h-5 text-t1" />
									<MapPinSearchIcon title="Friend can locate you on the map" class="w-5 h-5 text-t1" />
									<BoxIcon title="Friend can edit, delete or take your objects" class="w-5 h-5 text-t1" />
									<span class="w-1 shrink-0"></span>
									<MapPinSearchIcon title="You can locate them on the map" class="w-5 h-5 text-t1" />
									<BoxIcon title="You can edit this friend's objects" class="w-5 h-5 text-t1" />
								</div>
								<div
									v-for="f in sortedFriends"
									:key="f.id"
									class="flex items-center gap-1 px-2 py-1 cursor-default border-b border-brd"
									:class="selectedId === f.id ? 'bg-white/10' : 'hover:bg-white/5'"
									@click="selectFriend(f)"
									@dblclick="openIM(f)"
								>
									<span class="w-2 h-2 rounded-full shrink-0" :class="f.online ? 'bg-green-500' : 'bg-gray-500/50'" :title="f.online ? 'Online' : 'Offline'" />
									<span class="flex-1 min-w-0 truncate text-xs" :class="f.online ? 'text-t1' : 'text-tm'">{{ friendLabel(f) }}</span>
									<input type="checkbox" class="w-5 accent-accent shrink-0 cursor-pointer" title="Friend can see when you're online"
										:checked="hasRight(f.rightsGiven, RIGHT_ONLINE)" @click.stop="toggleRight(f, RIGHT_ONLINE)" />
									<input type="checkbox" class="w-5 accent-accent shrink-0 cursor-pointer" title="Friend can locate you on the map"
										:checked="hasRight(f.rightsGiven, RIGHT_MAP)" @click.stop="toggleRight(f, RIGHT_MAP)" />
									<input type="checkbox" class="w-5 accent-accent shrink-0 cursor-pointer" title="Friend can edit, delete or take your objects"
										:checked="hasRight(f.rightsGiven, RIGHT_MODIFY)" @click.stop="toggleRight(f, RIGHT_MODIFY)" />
									<span class="w-1 shrink-0"></span>
									<input type="checkbox" disabled class="w-5 shrink-0 opacity-60" title="You can locate them on the map"
										:checked="hasRight(f.rightsHas, RIGHT_MAP)" @click.stop />
									<input type="checkbox" disabled class="w-5 shrink-0 opacity-60" title="You can edit this friend's objects"
										:checked="hasRight(f.rightsHas, RIGHT_MODIFY)" @click.stop />
								</div>
							</div>
						</div>
						<div class="flex flex-col gap-1 px-2 py-1.5 border-t border-brd shrink-0">
							<button class="ui-btn py-0 px-3" :disabled="!canIM"       title="Send IM (Call disabled until voice)" @click="actIM">IM</button>
							<button class="ui-btn py-0 px-3" :disabled="!canProfile"  title="View profile" @click="actProfile">Profile</button>
							<button class="ui-btn py-0 px-3" :disabled="!canTeleport" title="Offer teleport" @click="actTeleport">Teleport&#8230;</button>
							<button class="ui-btn py-0 px-3" :disabled="!canMap"      title="Show on map" @click="actMap">Map</button>
							<button class="ui-btn py-0 px-3" disabled                 title="Pay — not yet available">Pay&#8230;</button>
							<button class="ui-btn py-0 px-3" :disabled="!canRemove"   title="Remove friend" @click="actRemove">Remove&#8230;</button>
							<button class="ui-btn py-0 px-3" title="Add a friend by name" @click="openAdd">Add</button>
						</div>
						<div v-if="showAdd" class="px-2 py-2 border-t border-brd shrink-0 bg-card2">
							<div class="flex gap-1.5">
								<input v-model="addQuery" type="text" placeholder="Search by name…" maxlength="63"
									class="flex-1 min-w-0 bg-card border border-brd rounded text-t1 placeholder-tm px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-accent"
									@keyup.enter="runAddSearch" />
								<button class="qs-btn-mini" :disabled="addBusy || addQuery.trim().length < 2" @click="runAddSearch">{{ addBusy ? '…' : 'Search' }}</button>
								<button class="qs-btn-mini" @click="showAdd = false">Cancel</button>
							</div>
							<div v-if="addResults.length" class="mt-1.5 max-h-32 overflow-y-auto">
								<button v-for="r in addResults" :key="r.id"
									class="block w-full text-left px-2 py-1 text-xs text-t1 hover:bg-white/10 rounded"
									@click="addFriendFromResult(r)">{{ r.name }}</button>
							</div>
							<div v-else-if="!addBusy && addQuery.trim().length >= 2" class="mt-1.5 text-2xs text-tm italic">No matches.</div>
						</div>
					</div>
				</template>

				<!-- Nearby Chat ─────────────────────────────────────── -->
				<template v-else-if="activeTab === 'nearby'">
					<div
						ref="msgEl"
						class="flex-1 overflow-y-auto px-2.5 py-1.5 flex flex-col-reverse gap-0.5 min-h-0 cursor-text"
						@click="focusInput"
					>
						<div
							v-for="m in [...messages].reverse().slice(0, 60)"
							:key="m.id"
							:class="['text-xs leading-snug', TYPE_CLASS[m.chatType] ?? 'text-t1']"
						>
							<span class="text-tm text-2xs me-1 select-none">{{ formatTime(m.timestamp) }}</span>
							<button v-if="m.sourceId" class="inline text-accent font-medium hover:underline" title="Learn more about this Resident" @click.stop="openProfile(m.sourceId)">{{ m.fromName }}</button>
							<span v-else class="text-accent font-medium">{{ m.fromName }}</span>:
							{{ m.message }}
						</div>
						<div v-if="!messages.length" class="py-4 text-gray-200 text-xs italic">
							No messages yet.
						</div>
					</div>
					<form
						class="flex gap-1.5 px-2 py-1.5 border-t border-brd shrink-0"
						@submit.prevent="submitChat"
					>
						<input
							ref="inputEl"
							v-model="chatInput"
							type="text"
							placeholder="To nearby chat"
							class="flex-1 bg-white/10 border border-t1 text-t1 placeholder-white/30 rounded px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-accent"
							maxlength="1023"
							@input="onInput"
						/>
						<div class="relative shrink-0">
							<button
								title="Show emoji panel"
								class="flex items-center px-2 py-1 bg-accent2 text-white rounded text-base hover:opacity-80"
								@click="toggleEmoji"
							>
								<span class="text-base leading-none">🙂</span>
								<ChevronDownIcon class="w-3.5 h-3.5 ml-0.5" />
							</button>
							<div
								v-if="showEmoji"
								class="absolute bottom-full right-0 mb-1 z-50"
								@click.stop
							>
								<emoji-picker class="dark" @emoji-click="onEmojiClick" />
							</div>
						</div>
						<button
							type="submit"
							class="px-2 py-1 bg-accent text-white rounded text-xs hover:opacity-80 shrink-0"
						>Send</button>
					</form>
				</template>

				<!-- IM tab (per avatar) ──────────────────────────────── -->
				<template v-else-if="activeConv">
					<!-- IM action bar (FS-style; several disabled until those systems exist) -->
					<div class="flex flex-wrap gap-1 px-2 py-1.5 border-b border-brd shrink-0">
						<button class="qs-btn-mini" title="Show this resident's profile" @click="imProfile"><ShieldUserIcon class="w-4 h-4" /></button>
						<button :disabled="imIsFriend" class="qs-btn-mini" title="Add this resident as a friend" @click="imAddFriend"><HandshakeIcon class="w-4 h-4" /></button>
						<!-- <button v-else class="qs-btn-mini" title="Remove friend" @click="imRemove">Remove</button> -->
						<button class="qs-btn-mini" disabled title="Offer teleport — not yet available">TP!</button>
						<button class="qs-btn-mini" disabled title="Request teleport — not yet available">TP?</button>
						<button class="qs-btn-mini" disabled title="Send an item to this resident — not yet available"><GiftIcon class="w-4 h-4" /></button>
						<button class="qs-btn-mini" disabled title="Add a voice to this chat — not yet available"><PhoneIcon class="w-4 h-4" /></button>
						<button class="qs-btn-mini" disabled title="Open this conversation's past transcripts — not yet available"><CaptionsIcon class="w-4 h-4" /></button>
						<button class="qs-btn-mini" disabled title="Add someone to this conversation — not yet available"><UserPlusIcon class="w-4 h-4" /></button>
						<button class="qs-btn-mini" disabled title="Chat options — not yet available"><SquareMenuIcon class="w-4 h-4" /></button>
						<button class="qs-btn-mini" disabled title="Search chat — not yet available"><SearchIcon class="w-4 h-4" /></button>
						<button class="qs-btn-mini" :disabled="!imMapEnabled" title="Show on map" @click="imMap"><MapIcon class="w-4 h-4" /></button>
						<!-- <button class="qs-btn-mini" disabled title="Pay — not yet available">Pay</button>
						<button class="qs-btn-mini" disabled title="Block/Mute — not yet available">Block</button>
						<button class="qs-btn-mini" disabled title="Group — not yet available">Group</button> -->
						<button class="qs-btn-mini" title="Close conversation" @click="imCloseConv"><XIcon class="w-4 h-4" /></button>
					</div>
					<div
						ref="imLogEl"
						class="flex-1 overflow-y-auto px-2.5 py-1.5 flex flex-col-reverse gap-0.5 min-h-0 cursor-text"
						@click="imInputEl?.focus()"
					>
						<div
							v-for="(m, i) in [...activeConv.messages].reverse().slice(0, 200)"
							:key="i"
							class="text-xs leading-snug text-t1"
						>
							<span class="text-t1 text-2xs me-1 select-none">{{ formatTime(m.ts) }}</span>
							<button v-if="m.fromId" class="inline text-accent font-medium hover:underline" title="Learn more about this Resident" @click.stop="openProfile(m.fromId)">{{ m.from }}</button>
							<span v-else class="text-accent font-medium">{{ m.from }}</span>:
							{{ m.text }}
						</div>
						<div v-if="!activeConv.messages.length" class="py-4 text-gray-200 text-xs italic">
							No messages yet — say hello.
						</div>
					</div>
					<form
						class="flex gap-1.5 px-2 py-1.5 border-t border-brd shrink-0"
						@submit.prevent="submitIM"
					>
						<input
							ref="imInputEl"
							v-model="imInput"
							type="text"
							:placeholder="`To ${activeConv.agentName}`"
							class="flex-1 bg-white/10 border border-t1 text-t1 placeholder-white/30 rounded px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-accent"
							maxlength="1023"
							@input="onImInput"
						/>
						<div class="relative shrink-0">
							<button
								title="Show emoji panel"
								class="flex items-center px-2 py-1 bg-accent2 text-white rounded text-base hover:opacity-80"
								@click="toggleEmoji"
							>
								<span class="text-base leading-none">🙂</span>
								<ChevronDownIcon class="w-3.5 h-3.5 ml-0.5" />
							</button>
							<div
								v-if="showEmoji"
								class="absolute bottom-full right-0 mb-1 z-50"
								@click.stop
							>
								<emoji-picker class="dark" @emoji-click="onEmojiClick" />
							</div>
						</div>
						<button
							type="submit"
							class="px-2 py-0.5 bg-accent text-white rounded text-xs hover:opacity-80 shrink-0"
						>Send</button>
					</form>
				</template>

				<template v-else>
					<div class="flex-1 flex items-center justify-center text-gray-200 text-xs italic select-none">
						Right-click an avatar to start an IM.
					</div>
				</template>

			</div>
		</div>
	</FloaterWindow>
</template>

<style>
/* WHY: emoji-picker-element uses shadow DOM — CSS vars cross the boundary, scoped attrs don't */
emoji-picker {
	--background:               #16161e;
	--border-color:             rgba(255,255,255,0.12);
	--indicator-color:          var(--color-accent, #7c3aed);
	--input-border-color:       rgba(255,255,255,0.2);
	--input-font-color:         #e2e2e2;
	--input-placeholder-color:  rgba(255,255,255,0.35);
	--outline-color:            transparent;
	--category-font-color:      rgba(255,255,255,0.45);
	--emoji-size:               1.35rem;
	--num-columns:              8;
	width:  352px;
	height: 300px;
	border-radius: 0.375rem;
	box-shadow: 0 8px 32px rgba(0,0,0,0.6);
}
</style>
