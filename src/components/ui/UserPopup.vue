<script setup>
/**
 * UserPopup — appears when clicking an avatar in the 3D scene.
 * Shows profile info and quick-action buttons: DM, Zoom, Email, Go to room.
 */
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useOfficeStore } from '@/stores/officeStore.js'
import { useAvatarStore } from '@/stores/avatarStore.js'
import { usePresenceStore } from '@/stores/presenceStore.js'
import { usePresence } from '@/composables/usePresence.js'
import { useMessaging } from '@/composables/useMessaging.js'
import { giveKudos } from '@/composables/useKudos.js'
import { useAudio } from '@/composables/useAudio.js'
import gsap from 'gsap'
import { useCallHere } from '@/composables/useCallHere.js'
import { connectedPeerIds, localVoiceEnabled } from '@/composables/useProximityVoice.js'
import { slackStatusForDisplay } from '@/utils/slackStatusFormat.js'

const officeStore   = useOfficeStore()
const avatarStore   = useAvatarStore()
const presenceStore = usePresenceStore()
const presence      = usePresence()
const messaging     = useMessaging()
const { playGreet } = useAudio()
const { sendCallHere, sending: callSending, sent: callSent } = useCallHere()

const visible  = ref(false)
const user     = ref(null)
const pos      = ref({ x: 0, y: 0 })
const dmOpening = ref(false)
const dmError   = ref('')
const showKudos    = ref(false)
const kudosMessage = ref('')
const kudosSending = ref(false)
const kudosError   = ref('')
const KUDOS_MAX    = 280

const POPUP_W = 260
const POPUP_H = 320

function onUserClick(e) {
	const clickedId = e.detail.user?.id
	// onDocPointerDown already closed the popup; suppress re-open for same avatar
	if (closedForUserId === clickedId) { closedForUserId = null; return }
	closedForUserId = null
	user.value     = e.detail.user
	dmOpening.value = false
	dmError.value  = ''

	// Keep popup inside viewport
	const x = Math.min(e.detail.screenX + 12, window.innerWidth  - POPUP_W - 12)
	const y = Math.min(e.detail.screenY - 20,  window.innerHeight - POPUP_H - 12)
	pos.value = { x: Math.max(12, x), y: Math.max(12, y) }
	visible.value = true
}

function close() {
	visible.value   = false
	dmOpening.value = false
	dmError.value   = ''
	showKudos.value    = false
	kudosMessage.value = ''
	kudosSending.value = false
	kudosError.value   = ''
}

async function sendKudos() {
	if (!user.value) return
	const trimmed = kudosMessage.value.trim()
	if (!trimmed) { kudosError.value = 'Write something first'; return }
	kudosSending.value = true
	kudosError.value   = ''
	try {
		await giveKudos(user.value, trimmed)
		close()
	} catch (err) {
		kudosError.value   = err.message || 'Could not send kudos'
		kudosSending.value = false
	}
}

function goToRoom() {
	if (user.value) officeStore.visitUser(user.value)
	close()
}

async function openDm() {
	dmOpening.value = true
	dmError.value   = ''
	try {
		await messaging.openDmWithUser(user.value)
		close()
	} catch (err) {
		dmError.value   = err.message || 'Could not open DM'
		dmOpening.value = false
	}
}

function openZoom() {
	window.open('https://zoom.us/start/videomeeting', '_blank')
}

function openEmail() {
	window.location.href = `mailto:${user.value?.email || ''}`
}

const initials = computed(() => {
	const name = user.value?.name || ''
	const parts = name.trim().split(' ')
	if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
	return name.slice(0, 2).toUpperCase() || '??'
})

const statusLabel = computed(() => {
	const map = { online: 'Online', away: 'Away', busy: 'Busy', offline: 'Offline' }
	return map[user.value?.status] || 'Offline'
})

const statusColor = computed(() => {
	const map = { online: '#00c853', away: '#ff6d00', busy: '#f44336', offline: '#4d6080' }
	return map[user.value?.status] || '#4d6080'
})

const displayStatus = computed(() => slackStatusForDisplay(user.value?.slackStatus))

const isVoiceConnected = computed(() => {
	if (!user.value?.id) return false
	if (isSelf.value) return localVoiceEnabled.value
	return connectedPeerIds.value.has(String(user.value.id))
})
const isSoundMuted     = computed(() => !!user.value?.avatarState?.soundMuted)

const isDevUser    = computed(() => user.value?.email?.includes('@localhost'))
const isSelf       = computed(() => !!user.value?.id && String(user.value.id) === String(presenceStore.myUserId))
const isInDifferentRoom = computed(() =>
	!!user.value && user.value.roomId !== officeStore.currentRoomId,
)
const isInSameRoom = computed(() =>
	!!user.value && user.value.roomId === officeStore.currentRoomId,
)

const myRoomName = computed(() =>
	(officeStore.currentRoomId || 'the office').replace(/-/g, ' '),
)

function greet() {
	if (!user.value) return
	playGreet()

	// Toast both names — include "from [room]" when greeting across rooms
	const myName    = avatarStore.displayName || 'Someone'
	const theirName = user.value.name || 'them'
	const message   = isInSameRoom.value
		? `${myName} greets ${theirName} 👋`
		: `${myName} greets ${theirName} from ${myRoomName.value} 👋`
	window.dispatchEvent(new CustomEvent('ava-toast', {
		detail: { message, type: 'info' },
	}))

	// Rotate both avatars to face each other (same-room only)
	if (isInSameRoom.value) {
		const engine    = officeStore.engineRef
		const myId      = presenceStore.myUserId || String(avatarStore.authUserId || 'me')
		const myGroup   = engine?.avatarGroups?.get(myId)
		const theirGroup = engine?.avatarGroups?.get(user.value.id)
		if (myGroup && theirGroup) {
			const dx = theirGroup.position.x - myGroup.position.x
			const dz = theirGroup.position.z - myGroup.position.z
			gsap.to(myGroup.rotation,    { y: Math.atan2(dx, dz),   duration: 0.38, ease: 'back.out(1.6)',
				onComplete: () => officeStore.setMyPose(myGroup.position.x, myGroup.position.z, myGroup.rotation.y) })
			gsap.to(theirGroup.rotation, { y: Math.atan2(-dx, -dz), duration: 0.38, ease: 'back.out(1.6)' })
		}
	}

	// Signal the other user via their presence row (SharePoint or Supabase)
	presence.sendGreeting(user.value.id)

	close()
}

const popupEl = ref(null)
let closedForUserId = null

function onEscCapture (e) {
	if (e.key !== 'Escape') return
	e.preventDefault()
	e.stopPropagation()
	close()
}
watch([visible, user], () => {
	document.removeEventListener('keydown', onEscCapture, true)
	if (visible.value && user.value) document.addEventListener('keydown', onEscCapture, true)
}, { immediate: true })

onMounted(() => {
	window.addEventListener('ava-user-click', onUserClick)
})
onUnmounted(() => {
	document.removeEventListener('keydown', onEscCapture, true)
	window.removeEventListener('ava-user-click', onUserClick)
})
</script>

<template>
	<Teleport to="body">
		<!-- Backdrop — catches outside clicks without letting them navigate the avatar -->
		<div v-if="visible && user" class="fixed inset-0 z-[299]" @pointerdown.self="close" />

		<Transition name="popup">
			<div
				v-if="visible && user"
				ref="popupEl"
				class="ava-panel fixed z-[300] w-64 rounded-xl overflow-hidden shadow-[0_12px_40px_rgba(0,0,0,0.6)]"
				:style="{ left: pos.x + 'px', top: pos.y + 'px' }"
			>
				<!-- Header -->
				<div class="flex items-start gap-[0.625rem] px-3.5 pt-3.5 pb-[0.625rem] border-b border-brd">
					<!-- Avatar bubble + voice indicators -->
					<div class="flex flex-col items-center gap-1 shrink-0">
						<div
							class="w-[2.625rem] h-[2.625rem] rounded-full flex items-center justify-center text-sm font-bold relative"
							style="color: rgba(255,255,255,0.92)"
							:style="{ background: user.color }"
						>
							{{ initials }}
							<!-- Status pip — border must match panel bg, so CSS var not TW -->
							<span class="up-pip absolute bottom-0 right-0 w-[0.6875rem] h-[0.6875rem] rounded-full border-2" :style="{ background: statusColor }" />
						</div>
						<div class="flex gap-[0.1875rem]">
							<span class="up-vi" :class="isVoiceConnected ? 'up-vi--on' : 'up-vi--off'" :title="isVoiceConnected ? 'Is on voice chat' : 'Is not on voice chat'">🎙</span>
							<span class="up-vi" :class="isSoundMuted ? 'up-vi--off' : 'up-vi--on'" :title="isSoundMuted ? 'Has sound muted' : 'Has sound on'">🔊</span>
						</div>
					</div>

					<!-- Name / title / status -->
					<div class="flex-1 min-w-0">
						<div class="text-sm font-bold text-t1 truncate">{{ user.name }}</div>
						<div class="text-[0.6875rem] text-tm truncate mb-1">{{ user.title || '' }}</div>
						<div class="text-[0.6875rem] text-t2 w-full">
							<div class="flex items-center gap-2">
								<span class="inline-block w-[0.4375rem] h-[0.4375rem] rounded-full shrink-0" :style="{ background: statusColor }"></span>
								{{ statusLabel }}
							</div>
							<div v-if="displayStatus" class="text-tm w-full truncate">· {{ displayStatus }}</div>
						</div>
					</div>

					<button
						class="bg-transparent border-0 text-tm cursor-pointer text-xs px-1 py-0.5 rounded leading-none shrink-0 self-start transition-colors hover:text-t1 hover:bg-white/[0.06]"
						@click="close"
					>✕</button>
				</div>

				<!-- Room location / navigate -->
				<div
					class="flex items-center gap-1.5 px-3.5 py-2 text-[0.6875rem] text-t2 border-b border-brd transition-colors duration-[120ms]"
					:class="isSelf ? 'opacity-40 cursor-default' : 'cursor-pointer hover:bg-white/[0.04]'"
					@click="!isSelf && goToRoom()"
				>
					<span class="text-[0.8125rem]">📍</span>
					<span class="text-capitalize">{{ user.roomId?.replace(/-/g, ' ') || 'Lobby' }}</span>
					<span v-if="!isSelf" class="ml-auto text-accent text-[0.6875rem] font-semibold">Go / visit / chat →</span>
				</div>

				<!-- DM error -->
				<div v-if="dmError" class="text-[0.6875rem] px-3.5 pt-1" style="color: var(--color-red)">{{ dmError }}</div>

				<!-- Greet (not self) — gradient not in TW, stays as class -->
				<div v-if="!isSelf" class="px-3 pt-2">
					<button class="up-btn--greet w-full flex items-center justify-center gap-2 rounded-[0.4375rem] text-sm font-bold py-2 transition-transform" @click="greet">
						<span>👋</span>
						<span v-if="isInSameRoom">Greet user</span>
						<span v-else>Greet from afar</span>
					</button>
				</div>

				<!-- Action buttons — use ava-btn component class from index.css -->
				<div class="grid grid-cols-2 gap-1.5 px-3 pt-2.5 pb-3">
					<button
						class="ava-btn flex items-center justify-center gap-1 rounded-[0.4375rem] text-xs font-semibold py-[0.4375rem] px-1"
						:disabled="dmOpening"
						title="Open DM thread"
						@click="openDm"
					>
						<span class="text-sm">💬</span>{{ dmOpening ? '…' : 'Message' }}
					</button>
					<button
						class="ava-btn flex items-center justify-center gap-1 rounded-[0.4375rem] text-xs font-semibold py-[0.4375rem] px-1"
						:disabled="!isInDifferentRoom || callSending"
						title="Invite them to meet you in your current room"
						@click="sendCallHere(user)"
					>
						<span class="text-sm">🏃‍➡️</span>{{ callSent ? 'Called!' : callSending ? '…' : 'Call to you' }}
					</button>
					<button
						class="ava-btn flex items-center justify-center gap-1 rounded-[0.4375rem] text-xs font-semibold py-[0.4375rem] px-1"
						:disabled="!user.email || isDevUser"
						@click="openEmail"
					>
						<span class="text-sm">📧</span> Email
					</button>
					<button
						class="ava-btn flex items-center justify-center gap-1 rounded-[0.4375rem] text-xs font-semibold py-[0.4375rem] px-1"
						@click="openZoom"
					>
						<span class="text-sm">🎥</span> Zoom
					</button>
					<button
						v-if="!isSelf && !isDevUser"
						class="ava-btn col-span-2 flex items-center justify-center gap-1 rounded-[0.4375rem] text-xs font-semibold py-[0.4375rem] px-1 up-btn--kudos"
						title="Send a public shout-out — appears on the break-room kudos wall"
						@click="showKudos = !showKudos"
					>
						<span class="text-sm">✨</span> {{ showKudos ? 'Cancel kudos' : 'Give kudos' }}
					</button>
				</div>

				<!-- Kudos inline form -->
				<div v-if="showKudos && !isSelf && !isDevUser" class="border-t border-brd px-3 pt-2.5 pb-3">
					<textarea
						v-model="kudosMessage"
						class="w-full resize-none rounded-[0.4375rem] bg-black/[0.18] border border-brd text-t1 text-xs p-2 leading-snug"
						rows="3"
						:maxlength="KUDOS_MAX"
						placeholder="What's the kudos for?"
						:disabled="kudosSending"
						@keydown.enter.exact.prevent="sendKudos"
					/>
					<div class="flex items-center justify-between mt-1.5">
						<span class="text-[0.625rem] text-tm">{{ kudosMessage.length }}/{{ KUDOS_MAX }}</span>
						<span v-if="kudosError" class="text-[0.625rem]" style="color: var(--color-red)">{{ kudosError }}</span>
					</div>
					<button
						class="up-btn--kudos-send w-full mt-2 flex items-center justify-center gap-2 rounded-[0.4375rem] text-sm font-bold py-2 transition-transform"
						:disabled="kudosSending || !kudosMessage.trim()"
						@click="sendKudos"
					>
						<span>✨</span>
						<span>{{ kudosSending ? 'Sending…' : 'Send kudos' }}</span>
					</button>
				</div>
			</div>
		</Transition>
	</Teleport>
</template>

<style scoped>
/* Pip border must match the card background — CSS var, not TW, so it tracks light mode */
.up-pip { border-color: var(--color-card); }

/* Voice icons — 0.8333rem and grayscale filter aren't in TW's scale */
.up-vi { font-size: 0.8333rem; line-height: 1; cursor: default; user-select: none; transition: opacity 0.18s, filter 0.18s; border: 2px solid; border-radius: 50%; padding: 0.0625rem; aspect-ratio: 1/1; }
.up-vi--on  { opacity: 1; background-color: #9e9; border-color: green; }
.up-vi--off { opacity: 0.33; background-color: red; border-color: red; }

/* Kudos button — warm gold gradient, distinct from cyan greet button */
.up-btn--kudos {
	background: linear-gradient(135deg, rgba(255, 200, 80, 0.14), rgba(255, 140, 60, 0.10));
	border: 1px solid rgba(255, 200, 80, 0.35);
	color: #ffc650;
	transition: background 0.15s, border-color 0.15s;
}
.up-btn--kudos:hover {
	background: linear-gradient(135deg, rgba(255, 200, 80, 0.24), rgba(255, 140, 60, 0.18));
	border-color: rgba(255, 200, 80, 0.6);
}
.up-btn--kudos-send {
	background: linear-gradient(135deg, rgba(255, 200, 80, 0.22), rgba(255, 140, 60, 0.16));
	border: 1px solid rgba(255, 200, 80, 0.5);
	color: #ffc650;
	transition: background 0.15s, border-color 0.15s, transform 0.1s;
}
.up-btn--kudos-send:hover:not(:disabled) {
	background: linear-gradient(135deg, rgba(255, 200, 80, 0.34), rgba(255, 140, 60, 0.24));
	border-color: rgba(255, 200, 80, 0.8);
	transform: scale(1.02);
}
.up-btn--kudos-send:active { transform: scale(0.97); }
.up-btn--kudos-send:disabled { opacity: 0.5; cursor: not-allowed; }

:global(html.light) .up-btn--kudos { color: #b06a00; }
:global(html.light) .up-btn--kudos-send { color: #b06a00; }

/* Greet button — gradient background has no TW equivalent */
.up-btn--greet {
	background: linear-gradient(135deg, rgba(0,200,140,0.14), rgba(0,180,216,0.10));
	border: 1px solid rgba(0,200,140,0.32);
	color: #00c88c;
	transition: background 0.15s, border-color 0.15s, transform 0.1s;
}
.up-btn--greet:hover {
	background: linear-gradient(135deg, rgba(0,200,140,0.24), rgba(0,180,216,0.18));
	border-color: rgba(0,200,140,0.55);
	transform: scale(1.02);
}
.up-btn--greet:active { transform: scale(0.97); }

/* Vue popup transition */
.popup-enter-active { transition: opacity 0.15s, transform 0.15s; }
.popup-leave-active { transition: opacity 0.1s, transform 0.1s; }
.popup-enter-from, .popup-leave-to { opacity: 0; transform: scale(0.94) translateY(-0.25rem); }

/* Light mode — hover backgrounds differ from dark */
:global(html.light) .up-btn--greet { color: #008a60; }
</style>
