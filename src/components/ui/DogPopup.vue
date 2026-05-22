<script setup>
/**
 * DogPopup — appears when clicking the office dog (Byte).
 * Offers three commands that are broadcast to every client via the commander's
 * AvatarState.dogCmd field (see dogApplyLatestCommand in useOfficeEngine.js):
 *   • Sit              → dog freezes in place
 *   • Throw ball       → ball arcs to a random spot in this user's room; dog fetches
 *   • Go to [user]     → dog walks (through doors, across rooms) to the chosen user
 *   • Call to you      → dogCmd goto-user to yourself — Byte paths to the caller (not SP invite)
 *   • Speak            → dogCmd speak — bark SFX + Woof! bubble on every client
 *   • Roll over        → dogCmd roll-over — short synchronized roll animation
 */
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useOfficeStore } from '@/stores/officeStore.js'
import { usePresenceStore } from '@/stores/presenceStore.js'
import { getRoomById } from '@/config/officeLayout.js'

const officeStore   = useOfficeStore()
const presenceStore = usePresenceStore()

const visible       = ref(false)
const pos           = ref({ x: 0, y: 0 })
/** null = main menu; 'goto' = pick someone for Byte to visit */
const pickerMode    = ref(null)

const myPresenceId = computed(() =>
	presenceStore.myUserId != null ? String(presenceStore.myUserId) : '',
)

/** Byte’s room (engine is markRaw — poll while menu is open). */
const byteRoomId = ref('lobby')
function refreshByteRoom() {
	byteRoomId.value = officeStore.engineRef?.getDogRoomId?.() ?? 'lobby'
}
let byteRoomPoll = null
watch(visible, (v) => {
	if (v) {
		refreshByteRoom()
		byteRoomPoll = setInterval(refreshByteRoom, 400)
	} else if (byteRoomPoll) {
		clearInterval(byteRoomPoll)
		byteRoomPoll = null
	}
})

const byteRoomLabel = computed(() =>
	getRoomById(byteRoomId.value)?.name || byteRoomId.value.replace(/-/g, ' '),
)
const sameRoomAsByte = computed(() => officeStore.currentRoomId === byteRoomId.value)

function goVisitByte() {
	if (sameRoomAsByte.value) return
	const rid = byteRoomId.value
	close()
	officeStore.navigateTo(rid)
}

// Popup box size (rem) — match UserPopup width (w-64); height fits 2-col action grid.
const POPUP_W_REM = 16
const POPUP_H_REM = 13.5
const remToPx = (rem) => rem * parseFloat(getComputedStyle(document.documentElement).fontSize || '16')

const onlineUsers = computed(() =>
	presenceStore.users
		.filter(u => u.status !== 'offline' && String(u.id) !== String(presenceStore.myUserId))
		.sort((a, b) => (a.name || '').localeCompare(b.name || '')),
)

function onDogClick(e) {
	const w = remToPx(POPUP_W_REM), h = remToPx(POPUP_H_REM)
	const x = Math.min(e.detail.screenX + 12, window.innerWidth  - w - 12)
	const y = Math.min(e.detail.screenY - 20, window.innerHeight - h - 12)
	pos.value = { x: Math.max(12, x), y: Math.max(12, y) }
	visible.value = true
	pickerMode.value = null
}

function close() {
	visible.value = false
	pickerMode.value = null
}

// Commands — all go through officeStore.setMyAvatarState so the next heartbeat
// carries them in AvatarState.dogCmd for every client to apply.
function issue(cmd) {
	const dogCmd = { ...cmd, issuedAt: Date.now() }
	officeStore.setMyAvatarState({ dogCmd })
	// Auto-clear the command after it's gone stale, so the SP row doesn't accumulate old cmds
	setTimeout(() => {
		const cur = officeStore.myAvatarState?.dogCmd
		if (cur && cur.issuedAt === dogCmd.issuedAt) officeStore.setMyAvatarState({ dogCmd: null })
	}, 95_000)
	close()
}

function cmdSit() {
	issue({ action: 'sit' })
}

function cmdSpeak() {
	issue({ action: 'speak' })
}

function cmdRollOver() {
	issue({ action: 'roll-over' })
}

function cmdThrow() {
	const roomId = officeStore.currentRoomId
	const bx = (typeof officeStore.myPosX === 'number') ? officeStore.myPosX : 0
	const bz = (typeof officeStore.myPosZ === 'number') ? officeStore.myPosZ : 0
	// Throw ~4 m in front of the avatar based on their facing direction
	const rot = officeStore.myRotation || 0
	const dist = 4
	const ballX = bx + Math.sin(rot) * dist
	const ballZ = bz + Math.cos(rot) * dist
	issue({ action: 'throw-ball', ballRoomId: roomId, ballX, ballZ })
}

function cmdGoto(userId) {
	issue({ action: 'goto-user', targetUserId: String(userId) })
}

/** Byte comes to the person who opened the menu (same dogCmd channel as "Go to user"). */
function cmdComeToMe() {
	const id = myPresenceId.value
	if (!id) return
	issue({ action: 'goto-user', targetUserId: id })
}

function onEscCapture (e) {
	if (e.key !== 'Escape') return
	e.preventDefault()
	e.stopPropagation()
	close()
}
watch(visible, () => {
	document.removeEventListener('keydown', onEscCapture, true)
	if (visible.value) document.addEventListener('keydown', onEscCapture, true)
}, { immediate: true })

onMounted(() => {
	window.addEventListener('ava-dog-click', onDogClick)
})
onUnmounted(() => {
	document.removeEventListener('keydown', onEscCapture, true)
	window.removeEventListener('ava-dog-click', onDogClick)
	if (byteRoomPoll) clearInterval(byteRoomPoll)
})
</script>

<template>
	<Teleport to="body">
		<!-- Backdrop — same pattern as UserPopup: absorbs outside clicks, .self so panel clicks don't close -->
		<div v-if="visible" class="fixed inset-0 z-[299]" @pointerdown.self="close" />

		<Transition name="popup">
			<div
				v-if="visible"
				class="dog-popup ava-panel fixed z-[300] w-64 rounded-xl overflow-hidden shadow-[0_12px_40px_rgba(0,0,0,0.6)] select-none"
				:style="{ left: pos.x + 'px', top: pos.y + 'px' }"
			>
			<!-- Header — spacing aligned with UserPopup -->
			<div class="flex items-center gap-[0.625rem] px-3.5 pt-3.5 pb-[0.625rem] border-b border-brd">
				<span class="text-base shrink-0">🐾</span>
				<span class="flex-1 min-w-0 font-bold text-sm text-t1">Byte</span>
				<button
					class="bg-transparent border-0 text-tm cursor-pointer text-xs px-1 py-0.5 rounded leading-none shrink-0 self-start transition-colors hover:text-t1 hover:bg-white/[0.06]"
					title="Close"
					@click="close"
				>✕</button>
			</div>

			<!-- Where Byte is — same pattern as UserPopup room row -->
			<div
				class="flex items-center gap-1.5 px-3.5 py-2 text-[0.6875rem] text-t2 border-b border-brd transition-colors duration-[120ms]"
				:class="sameRoomAsByte ? 'opacity-40 cursor-default' : 'cursor-pointer hover:bg-white/[0.04]'"
				@click="!sameRoomAsByte && goVisitByte()"
			>
				<span class="text-[0.8125rem]">📍</span>
				<span class="text-capitalize">{{ byteRoomLabel }}</span>
				<span v-if="!sameRoomAsByte" class="ml-auto text-accent text-[0.6875rem] font-semibold">Go / visit →</span>
			</div>

			<!-- Action buttons — two columns like UserPopup (ava-btn from index.css) -->
			<div v-if="!pickerMode" class="grid grid-cols-2 gap-1.5 px-3 pt-2.5 pb-3">
				<button
					class="ava-btn flex items-center justify-center gap-1 rounded-[0.4375rem] text-xs font-semibold py-[0.4375rem] px-1"
					title="Byte freezes in place"
					@click="cmdSit"
				>
					<span class="text-sm">🪑</span> Sit
				</button>
				<button
					class="ava-btn flex items-center justify-center gap-1 rounded-[0.4375rem] text-xs font-semibold py-[0.4375rem] px-1"
					title="Bark (respects mute-all in settings)"
					@click="cmdSpeak"
				>
					<span class="text-sm">🔊</span> Speak
				</button>
				<button
					class="ava-btn flex items-center justify-center gap-1 rounded-[0.4375rem] text-xs font-semibold py-[0.4375rem] px-1"
					title="Short roll animation"
					@click="cmdRollOver"
				>
					<span class="text-sm">🔄</span> Roll over
				</button>
				<button
					class="ava-btn flex items-center justify-center gap-1 rounded-[0.4375rem] text-xs font-semibold py-[0.4375rem] px-1"
					title="Throw ball — Byte fetches"
					@click="cmdThrow"
				>
					<span class="text-sm">🎾</span> Fetch
				</button>
				<button
					class="ava-btn flex items-center justify-center gap-1 rounded-[0.4375rem] text-xs font-semibold py-[0.4375rem] px-1"
					title="Byte walks to someone you pick"
					@click="pickerMode = 'goto'"
				>
					<span class="text-sm">🏃</span> Go to…
				</button>
				<button
					class="ava-btn flex items-center justify-center gap-1 rounded-[0.4375rem] text-xs font-semibold py-[0.4375rem] px-1"
					:disabled="!myPresenceId"
					:title="myPresenceId ? 'Byte comes to your current location' : 'Presence not ready yet'"
					@click="cmdComeToMe"
				>
					<span class="text-sm">🏃‍➡️</span> Call to you
				</button>
			</div>

			<!-- User picker (go to) -->
			<div v-else class="px-3 pt-2 pb-3 max-h-[17.5rem] flex flex-col">
				<div class="flex items-center gap-2 px-0.5 pb-2 border-b border-brd text-xs font-semibold text-tm">
					<button class="bg-transparent border-0 text-accent cursor-pointer text-xs px-1 py-0.5" @click="pickerMode = null">← Back</button>
					<span>Pick someone</span>
				</div>
				<div v-if="!onlineUsers.length" class="px-1.5 py-3.5 text-tm text-sm text-center">No one else is online.</div>
				<div class="flex flex-col overflow-y-auto">
					<button
						v-for="u in onlineUsers"
						:key="u.id"
						class="dog-user-row flex items-center gap-2 bg-transparent border-0 text-t1 px-1.5 py-1.5 rounded cursor-pointer text-left text-[0.8125rem]"
						@click="cmdGoto(u.id)"
					>
						<span class="inline-block w-2.5 h-2.5 rounded-full shrink-0" :style="{ background: u.color || '#4d6080' }"></span>
						<span class="flex-1 whitespace-nowrap overflow-hidden text-ellipsis">{{ u.name || 'Unknown' }}</span>
					</button>
				</div>
			</div>
			</div>
		</Transition>
	</Teleport>
</template>

<style scoped>
.dog-user-row:hover { background: rgba(255, 255, 255, 0.08); }
:global(html.light) .dog-user-row:hover { background: rgba(0, 0, 0, 0.06); }

.popup-enter-active, .popup-leave-active { transition: opacity 0.12s, transform 0.12s; }
.popup-enter-from, .popup-leave-to { opacity: 0; transform: translateY(-0.25rem); }
</style>
