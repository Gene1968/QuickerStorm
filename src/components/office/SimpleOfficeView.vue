<script setup>
import { computed } from 'vue'
import { useOfficeStore } from '@/stores/officeStore.js'
import { usePresenceStore } from '@/stores/presenceStore.js'
import { useTheme } from '@/composables/useTheme.js'
import { ALL_ROOMS, FLOOR_BOUNDS } from '@/config/officeLayout.js'
import { isRoomLocked } from '@/composables/usePresence.js'

const officeStore   = useOfficeStore()
const presenceStore = usePresenceStore()
const { isDark }    = useTheme()

// ── SVG projection (same as FloorplanOverlay) ────────────────────────
const SVG_W = 780
const SVG_H = 680
const scaleX = SVG_W / FLOOR_BOUNDS.width
const scaleZ = SVG_H / FLOOR_BOUNDS.depth

function worldToSVG (wx, wz) {
	return {
		x: (wx - FLOOR_BOUNDS.minX) * scaleX,
		y: (wz - FLOOR_BOUNDS.minZ) * scaleZ,
	}
}

const roomRects = computed(() => {
	const dark = isDark.value
	const fillMap = dark ? {
		lobby:      '#0d2035', conference: '#0d1a2e', meeting: '#0b1828',
		breakroom:  '#0d1e18', gym: '#1a1010', corridor: '#090e18', office: '#0a1422',
	} : {
		lobby:      '#c8dff5', conference: '#c2d8f0', meeting: '#c8d8f0',
		breakroom:  '#c8eedd', gym: '#f0d8d0', corridor: '#d8e4f0', office: '#ccd8ee',
	}
	return ALL_ROOMS.map(room => {
		const { x, y } = worldToSVG(room.pos[0] - room.size[0] / 2, room.pos[1] - room.size[1] / 2)
		const w = room.size[0] * scaleX
		const h = room.size[1] * scaleZ
		const cx = x + w / 2
		const cy = y + h / 2
		const isActive  = officeStore.currentRoomId === room.id
		const userCount = presenceStore.usersInRoom(room.id).length
		const locked    = isRoomLocked(room.id)
		return { room, x, y, w, h, cx, cy, isActive, userCount, locked, fill: fillMap[room.type] || (dark ? '#0a1422' : '#ccd8ee') }
	})
})

const userDots = computed(() => presenceStore.users.map(user => {
	const room = ALL_ROOMS.find(r => r.id === user.roomId)
	if (!room) return null
	const { x, y } = worldToSVG(room.pos[0], room.pos[1])
	const hash = user.id.charCodeAt(0) || 0
	return { user, cx: x + (hash % 20) - 10, cy: y + (hash % 14) - 7 }
}).filter(Boolean))

const myDot = computed(() => {
	const room = ALL_ROOMS.find(r => r.id === officeStore.currentRoomId)
	if (!room) return null
	const { x, y } = worldToSVG(room.pos[0], room.pos[1])
	return { cx: x, cy: y }
})

// ── Navigation (engineless) ──────────────────────────────────────────
function handleRoomClick (room) {
	if (room.id === officeStore.currentRoomId) return
	officeStore.setCurrentRoom(room.id)
	officeStore.setCurrentSeat(null)
	presenceStore.setMySeatId(null)
	sessionStorage.setItem('ava_last_room', room.id)
	sessionStorage.removeItem('ava_last_seat')
}

// ── Sit / Stand ──────────────────────────────────────────────────────
const isSeated    = computed(() => !!officeStore.currentSeatId)
const currentRoom = computed(() => officeStore.currentRoom)

function takeNearestEmptySeat () {
	const seats = currentRoom.value?.seats || []
	const available = seats.find(s => {
		const takenBy = presenceStore.users.find(u =>
			u.seatId === s.seatId &&
			String(u.id) !== String(presenceStore.myUserId) &&
			u.status !== 'offline',
		)
		return !takenBy
	})
	if (!available) {
		window.dispatchEvent(new CustomEvent('ava-toast', { detail: { message: 'No seats available in this room', type: 'warn' } }))
		return
	}
	// Mirror the engine: set pose at seat position facing the focal point so
	// other users in graphical view see the avatar oriented correctly.
	const [px, , pz] = available.pos
	const rot = available.focal
		? Math.atan2(available.focal[0] - px, available.focal[2] - pz)
		: 0
	officeStore.setMyPose(px, pz, rot)
	sessionStorage.setItem('ava_last_pos_x', String(px))
	sessionStorage.setItem('ava_last_pos_z', String(pz))
	sessionStorage.setItem('ava_last_rotation', String(rot))
	officeStore.setCurrentSeat(available.seatId)
	presenceStore.setMySeatId(available.seatId)
	sessionStorage.setItem('ava_last_seat', available.seatId)
}

function standUp () {
	// Place avatar at the seat's world position before clearing seat state
	const seatId = officeStore.currentSeatId
	const seat = currentRoom.value?.seats?.find(s => s.seatId === seatId)
	if (seat) {
		const [posX, , posZ] = seat.pos
		officeStore.setMyPose(posX, posZ, 0)
		sessionStorage.setItem('ava_last_pos_x', String(posX))
		sessionStorage.setItem('ava_last_pos_z', String(posZ))
		sessionStorage.removeItem('ava_last_rotation')
	}
	officeStore.setCurrentSeat(null)
	presenceStore.setMySeatId(null)
	sessionStorage.removeItem('ava_last_seat')
}

// ── Users ────────────────────────────────────────────────────────────
const usersHere = computed(() => presenceStore.usersInRoom(officeStore.currentRoomId))

function onUserClick (user, event) {
	window.dispatchEvent(new CustomEvent('ava-user-click', {
		detail: { user, screenX: event.clientX, screenY: event.clientY },
	}))
}

// ── Room actions (canvas items for non-3D users) ─────────────────────
const holding = computed(() => officeStore.myAvatarState?.holding)

function getCoffee () {
	const isRefill = holding.value === 'coffee'
	officeStore.setMyAvatarState({ holding: 'coffee', heldAt: Date.now() })
	window.dispatchEvent(new CustomEvent('ava-toast', {
		detail: { message: isRefill ? '☕ Coffee refilled!' : '☕ Enjoy your coffee!', type: 'success' },
	}))
}

function getWater () {
	const isRefill = holding.value === 'water'
	officeStore.setMyAvatarState({ holding: 'water', heldAt: Date.now() })
	window.dispatchEvent(new CustomEvent('ava-toast', {
		detail: { message: isRefill ? '💧 Water refilled!' : '💧 Refreshing!', type: 'success' },
	}))
}

function openByte (event) {
	window.dispatchEvent(new CustomEvent('ava-dog-click', {
		detail: { screenX: event.clientX, screenY: event.clientY },
	}))
}

function openMonitor () {
	window.dispatchEvent(new CustomEvent('ava-monitor-click', {
		detail: { roomId: officeStore.currentRoomId },
	}))
}

const canOpenMonitor = computed(() => !!officeStore.myCurrentOfficeId)

const roomActions = computed(() => {
	const roomId = officeStore.currentRoomId
	const h = holding.value
	if (roomId === 'break-room') {
		return [
			{ id: 'coffee',     label: h === 'coffee' ? '☕ Refill coffee' : '☕ Get coffee',   fn: getCoffee },
			{ id: 'water',      label: h === 'water'  ? '💧 Refill water'  : '💧 Get water',    fn: getWater },
			{ id: 'snake',      label: '🎮 Play Snake',       event: 'ava-arcade-click' },
			{ id: 'pacman',     label: '👾 Play Pac-Man',     event: 'ava-arcade-pacman-click' },
			{ id: 'centipede',  label: '🦟 Play Centipede',   event: 'ava-arcade-centipede-click' },
			{ id: 'suggestion', label: '📬 Suggestion box',   event: 'ava-suggestion-box-click' },
		]
	}
	if (roomId === 'lobby') {
		return [
			{ id: 'magazine',  label: '📖 Read magazine', fn: () => window.dispatchEvent(new CustomEvent('ava-magazine-click', { detail: { url: 'https://laspaceforce.com' } })) },
			{ id: 'ticket',    label: '🎟 Pull a ticket',   event: 'ava-ticket-pull' },
			{ id: 'intercom',  label: '📢 Announcement',    event: 'ava-intercom-click' },
		]
	}
	return []
})

function runAction (action, event) {
	if (action.fn) action.fn(event)
	else window.dispatchEvent(new CustomEvent(action.event, { detail: { roomId: officeStore.currentRoomId } }))
}
</script>

<template>
	<div class="sv-root">
		<!-- Left: interactive floorplan SVG -->
		<div class="sv-map-wrap">
			<p class="sv-hint ps-28">Tap a room below to navigate</p>
			<svg
				:viewBox="`0 0 ${SVG_W} ${SVG_H}`"
				class="sv-svg"
				xmlns="http://www.w3.org/2000/svg"
			>
				<g
					v-for="rect in roomRects" :key="rect.room.id"
					class="sv-room"
					:class="{ active: rect.isActive }"
					@click="handleRoomClick(rect.room)"
				>
					<rect
						:x="rect.x" :y="rect.y" :width="rect.w" :height="rect.h"
						:fill="rect.fill"
						:stroke="rect.isActive ? '#00b4d8' : (isDark ? '#1e2d45' : '#90afd0')"
						:stroke-width="rect.isActive ? 1.5 : 0.8"
						rx="3"
					/>
					<text
						:x="rect.cx" :y="rect.cy"
						text-anchor="middle" dominant-baseline="middle"
						:font-size="rect.room.type === 'office' ? 5 : rect.w < 60 ? 6.5 : 8"
						:fill="rect.isActive ? (isDark ? '#90e0ef' : '#0077b6') : (isDark ? '#8da0b8' : '#1e3d5c')"
						font-family="Inter, sans-serif" font-weight="600"
					>{{ rect.room.type === 'office' ? rect.room.name.replace('Office ', '') : rect.room.name }}</text>

					<g v-if="rect.userCount > 0">
						<circle :cx="rect.x + rect.w - 8" :cy="rect.y + 8" r="7" fill="#a78bfa" />
						<text :x="rect.x + rect.w - 8" :y="rect.y + 8"
							text-anchor="middle" dominant-baseline="middle"
							font-size="6" fill="white" font-weight="700">{{ rect.userCount }}</text>
					</g>

					<text v-if="rect.locked"
						:x="rect.x + 8" :y="rect.y + 10"
						font-size="7" text-anchor="middle" dominant-baseline="middle">🔒</text>

					<rect v-if="rect.isActive"
						:x="rect.x" :y="rect.y" :width="rect.w" :height="rect.h"
						:fill="isDark ? 'rgba(0,180,216,0.06)' : 'rgba(0,119,182,0.08)'" rx="3"
					/>
				</g>

				<g v-for="dot in userDots" :key="dot.user.id">
					<circle :cx="dot.cx" :cy="dot.cy" r="5"
						:fill="dot.user.color || '#a78bfa'"
						:stroke="isDark ? '#080d14' : '#ffffff'" stroke-width="1" />
					<text :x="dot.cx" :y="dot.cy + 10"
						text-anchor="middle" font-size="5"
						:fill="isDark ? (dot.user.color || '#c4b5fd') : '#5b21b6'"
						font-family="Inter, sans-serif">{{ dot.user.name?.split(' ')[0]?.slice(0, 4) }}</text>
				</g>

				<g v-if="myDot">
					<circle :cx="myDot.cx" :cy="myDot.cy" r="7"
						fill="#f97316" stroke="white" stroke-width="1.5" class="sv-my-pulse" />
					<text :x="myDot.cx" :y="myDot.cy + 13"
						text-anchor="middle" font-size="5.5"
						:fill="isDark ? '#fdba74' : '#c2410c'"
						font-weight="700" font-family="Inter, sans-serif">You</text>
				</g>

				<text x="14" y="16" font-size="8" :fill="isDark ? '#4d6080' : '#4a6880'" font-family="Inter">N↑</text>
			</svg>

			<div class="sv-legend">
				<span class="sv-leg"><span class="sv-dot" style="background:#f97316"></span> You</span>
				<span class="sv-leg"><span class="sv-dot" style="background:#a78bfa"></span> Others</span>
				<span class="sv-leg-tip">Tap room to navigate</span>
			</div>
		</div>

		<!-- Right: room context panel -->
		<div class="sv-panel pt-16 pb-28">
			<div class="sv-room-name">{{ currentRoom?.name || 'Lobby' }}</div>

			<!-- Sit / Stand -->
			<div class="sv-actions sv-seat-row">
				<button v-if="isSeated" class="sv-action-btn sv-action-btn--primary" @click="standUp">🧍 Stand up</button>
				<button v-else-if="currentRoom?.seats?.length" class="sv-action-btn" @click="takeNearestEmptySeat">💺 Take nearest seat</button>
			</div>

			<!-- People here (clickable → UserPopup) -->
			<div class="sv-section-label">In this room ({{ usersHere.length }})</div>
			<div v-if="usersHere.length === 0" class="sv-empty">Just you</div>
			<ul class="sv-user-list">
				<li
					v-for="u in usersHere" :key="u.id"
					class="sv-user-row sv-user-row--click"
					@click="onUserClick(u, $event)"
					title="Click to interact"
				>
					<span class="sv-user-dot" :style="{ background: u.color || '#a78bfa' }"></span>
					<span class="sv-user-name">{{ u.name }}</span>
					<span v-if="u.title" class="sv-user-title">{{ u.title }}</span>
					<span class="sv-user-caret">›</span>
				</li>
			</ul>

			<!-- Room-specific canvas actions -->
			<template v-if="roomActions.length > 0">
				<div class="sv-section-label sv-actions-label">Room</div>
				<div class="sv-actions">
					<button
						v-for="action in roomActions" :key="action.id"
						class="sv-action-btn"
						@click="runAction(action, $event)"
					>{{ action.label }}</button>
				</div>
			</template>

			<!-- My office monitor -->
			<template v-if="canOpenMonitor">
				<div class="sv-section-label sv-actions-label">Your office</div>
				<div class="sv-actions">
					<button class="sv-action-btn" @click="openMonitor">💻 My computer</button>
				</div>
			</template>

			<!-- Byte — available everywhere -->
			<div class="sv-actions sv-byte-row">
				<button class="sv-action-btn sv-action-btn--byte" @click="openByte($event)">🐕 Find Byte</button>
			</div>
		</div>
	</div>
</template>

<style scoped>
.sv-root {
	display: flex;
	width: 100%;
	height: 100%;
	background: var(--color-bg);
	overflow: hidden;
}

/* ── Map (left) ── */
.sv-map-wrap {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	padding: 0.75rem 0.5rem 0.5rem 0.75rem;
	overflow: hidden;
}

.sv-hint {
	font-size: 0.6875rem;
	color: var(--color-tm);
	margin: 0 0 0.375rem 0.25rem;
}

.sv-svg {
	display: block;
	flex: 1;
	min-height: 0;
	width: 100%;
	background: var(--fp-svg-bg, #060c14);
	border-radius: 0.5rem;
	border: 1px solid var(--color-brd);
	cursor: pointer;
}

.sv-room { cursor: pointer; transition: opacity 0.12s; }
.sv-room:hover rect:first-child { stroke: #00b4d8 !important; }

@keyframes sv-pulse { 0%, 100% { r: 7; opacity: 1; } 50% { r: 10; opacity: 0.6; } }
.sv-my-pulse { animation: sv-pulse 2s ease-in-out infinite; }

.sv-legend {
	display: flex;
	align-items: center;
	gap: 1rem;
	padding: 0.5rem 0.25rem 0;
}
.sv-leg { display: flex; align-items: center; gap: 0.3125rem; font-size: 0.6875rem; color: var(--color-t2); }
.sv-dot { display: inline-block; width: 0.5rem; height: 0.5rem; border-radius: 50%; }
.sv-leg-tip { margin-left: auto; font-size: 0.6875rem; color: var(--color-tm); font-style: italic; }

/* ── Panel (right) ── */
.sv-panel {
	width: 16rem;
	flex-shrink: 0;
	border-left: 1px solid var(--color-brd);
	padding: 1rem 0.875rem;
	overflow-y: auto;
	display: flex;
	flex-direction: column;
	gap: 0.25rem;
	background: var(--color-card2);
}

.sv-room-name {
	font-size: 1rem;
	font-weight: 700;
	color: var(--color-t1);
	margin-bottom: 0.625rem;
	padding-bottom: 0.625rem;
	border-bottom: 1px solid var(--color-brd);
}

.sv-section-label {
	font-size: 0.6875rem;
	font-weight: 600;
	color: var(--color-tm);
	text-transform: uppercase;
	letter-spacing: 0.06em;
	margin-top: 0.75rem;
	margin-bottom: 0.25rem;
}
.sv-actions-label { margin-top: 1rem; }

.sv-empty { font-size: 0.8125rem; color: var(--color-tm); }

/* ── User list ── */
.sv-user-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.25rem; }

.sv-user-row {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	padding: 0.375rem 0.5rem;
	border-radius: 0.375rem;
}

.sv-user-row--click {
	cursor: pointer;
	transition: background 0.12s;
}
.sv-user-row--click:hover { background: rgba(255,255,255,0.06); }
:global(html.light) .sv-user-row--click:hover { background: rgba(0,100,180,0.07); }

.sv-user-dot { width: 0.625rem; height: 0.625rem; border-radius: 50%; flex-shrink: 0; }
.sv-user-name { font-size: 0.8125rem; color: var(--color-t1); font-weight: 500; flex: 1; min-width: 0; }
.sv-user-title { font-size: 0.6875rem; color: var(--color-tm); }
.sv-user-caret { font-size: 0.75rem; color: var(--color-tm); margin-left: auto; }

/* ── Actions ── */
.sv-actions { display: flex; flex-direction: column; gap: 0.3125rem; }

.sv-seat-row { margin-top: 0.5rem; margin-bottom: 0.25rem; }
.sv-byte-row { margin-top: auto; padding-top: 0.875rem; }

.sv-action-btn {
	background: var(--color-card);
	border: 1px solid var(--color-brd);
	border-radius: 0.5rem;
	color: var(--color-t2);
	font-size: 0.8125rem;
	padding: 0.5rem 0.75rem;
	cursor: pointer;
	text-align: left;
	transition: background 0.12s, color 0.12s;
}
.sv-action-btn:hover { background: rgba(255,255,255,0.06); color: var(--color-t1); }
:global(html.light) .sv-action-btn:hover { background: rgba(0,100,180,0.07); }

.sv-action-btn--primary {
	background: rgba(249,115,22,0.15);
	border-color: rgba(249,115,22,0.35);
	color: #f97316;
}
.sv-action-btn--primary:hover { background: rgba(249,115,22,0.25); color: #fb923c; }

.sv-action-btn--byte {
	border-color: rgba(167,139,250,0.35);
	color: #a78bfa;
}
.sv-action-btn--byte:hover { background: rgba(167,139,250,0.1); color: #c4b5fd; }

/* ── Small screens: stack vertically ── */
@media (max-width: 600px) {
	.sv-root { flex-direction: column; }
	.sv-map-wrap { padding: 0.5rem; }
	.sv-panel { width: 100%; border-left: none; border-top: 1px solid var(--color-brd); flex-shrink: 0; max-height: 40vh; padding-top: 0.875rem !important; }
	.sv-byte-row { margin-top: 0.5rem; }
}
</style>
