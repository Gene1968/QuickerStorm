<script setup>
/**
 * FloorplanOverlay — SVG top-down floor plan.
 * Shows all rooms, user presence dots, and allows click-to-navigate.
 * Positioned absolutely over the Three.js canvas.
 */
import { computed } from 'vue'
import { useOfficeStore } from '@/stores/officeStore.js'
import { useModalAudio } from '@/composables/useModalAudio.js'
useModalAudio()
import { usePresenceStore } from '@/stores/presenceStore.js'
import { useTheme } from '@/composables/useTheme.js'
import { ALL_ROOMS, FLOOR_BOUNDS } from '@/config/officeLayout.js'

const officeStore   = useOfficeStore()
const presenceStore = usePresenceStore()
const { isDark }    = useTheme()

defineEmits(['navigate'])

// SVG viewport
const SVG_W = 780
const SVG_H = 680

// World-to-SVG scale
const scaleX = SVG_W / FLOOR_BOUNDS.width
const scaleZ = SVG_H / FLOOR_BOUNDS.depth

function worldToSVG(wx, wz) {
	return {
		x: (wx - FLOOR_BOUNDS.minX) * scaleX,
		y: (wz - FLOOR_BOUNDS.minZ) * scaleZ,
	}
}

const roomRects = computed(() => {
	const dark = isDark.value
	const fillMap = dark ? {
		lobby:      '#0d2035',
		conference: '#0d1a2e',
		meeting:    '#0b1828',
		breakroom:  '#0d1e18',
		gym:        '#1a1010',
		corridor:   '#090e18',
		office:     '#0a1422',
	} : {
		lobby:      '#c8dff5',
		conference: '#c2d8f0',
		meeting:    '#c8d8f0',
		breakroom:  '#c8eedd',
		gym:        '#f0d8d0',
		corridor:   '#d8e4f0',
		office:     '#ccd8ee',
	}

	return ALL_ROOMS.map(room => {
		const { x, y } = worldToSVG(room.pos[0] - room.size[0] / 2, room.pos[1] - room.size[1] / 2)
		const w = room.size[0] * scaleX
		const h = room.size[1] * scaleZ
		const cx = x + w / 2
		const cy = y + h / 2
		const isActive = officeStore.currentRoomId === room.id
		const userCount = presenceStore.usersInRoom(room.id).length
		return { room, x, y, w, h, cx, cy, isActive, userCount, fill: fillMap[room.type] || (dark ? '#0a1422' : '#ccd8ee') }
	})
})

const userDots = computed(() => {
	return presenceStore.users.map(user => {
		const room = ALL_ROOMS.find(r => r.id === user.roomId)
		if (!room) return null
		const { x, y } = worldToSVG(room.pos[0], room.pos[1])
		// Add a small jitter per user to avoid overlap
		const hash = user.id.charCodeAt(0) || 0
		return {
			user,
			cx: x + (hash % 20) - 10,
			cy: y + (hash % 14) - 7,
		}
	}).filter(Boolean)
})

const myDot = computed(() => {
	const roomId = officeStore.currentRoomId
	const room = ALL_ROOMS.find(r => r.id === roomId)
	if (!room) return null
	const { x, y } = worldToSVG(room.pos[0], room.pos[1])
	return { cx: x, cy: y }
})

function handleRoomClick(room) {
	const isNew = room.id !== officeStore.currentRoomId
	officeStore.navigateTo(room.id)
	if (isNew) close()
}

function close() {
	officeStore.showFloorplan = false
}
</script>

<template>
	<div class="floorplan-overlay">
		<!-- Backdrop -->
		<div class="fp-backdrop" @click="close" />

		<!-- Panel -->
		<div class="fp-panel">
			<div class="fp-header">
				<h3 class="fp-title">Office Floorplan</h3>
				<button class="fp-close" @click="close">✕</button>
			</div>

			<svg
				:viewBox="`0 0 ${SVG_W} ${SVG_H}`"
				class="fp-svg"
				xmlns="http://www.w3.org/2000/svg"
			>
				<!-- Rooms -->
				<g v-for="rect in roomRects" :key="rect.room.id"
					class="room-group"
					@click="handleRoomClick(rect.room)"
					:class="{ active: rect.isActive }"
				>
					<!-- Room fill -->
					<rect
						:x="rect.x" :y="rect.y" :width="rect.w" :height="rect.h"
						:fill="rect.fill"
						:stroke="rect.isActive ? '#00b4d8' : (isDark ? '#1e2d45' : '#90afd0')"
						:stroke-width="rect.isActive ? 1.5 : 0.8"
						rx="3"
					/>

					<!-- Room name -->
					<text
						:x="rect.cx" :y="rect.cy"
						text-anchor="middle" dominant-baseline="middle"
						:font-size="rect.room.type === 'office' ? 5 : rect.w < 60 ? 6.5 : 8"
						:fill="rect.isActive ? (isDark ? '#90e0ef' : '#0077b6') : (isDark ? '#8da0b8' : '#1e3d5c')"
						font-family="Inter, sans-serif"
						font-weight="600"
					>{{ rect.room.type === 'office' ? rect.room.name.replace('Office ', '') : rect.room.name }}</text>

					<!-- User count badge -->
					<g v-if="rect.userCount > 0">
						<circle :cx="rect.x + rect.w - 8" :cy="rect.y + 8" r="7" fill="#a78bfa" />
						<text :x="rect.x + rect.w - 8" :y="rect.y + 8"
							text-anchor="middle" dominant-baseline="middle"
							font-size="6" fill="white" font-weight="700">{{ rect.userCount }}</text>
					</g>

					<!-- Active indicator -->
					<rect v-if="rect.isActive"
						:x="rect.x" :y="rect.y" :width="rect.w" :height="rect.h"
						:fill="isDark ? 'rgba(0,180,216,0.06)' : 'rgba(0,119,182,0.08)'" rx="3"
					/>
				</g>

				<!-- Other users -->
				<g v-for="dot in userDots" :key="dot.user.id">
					<circle
						:cx="dot.cx" :cy="dot.cy" r="5"
						:fill="dot.user.color || '#a78bfa'"
						:stroke="isDark ? '#080d14' : '#ffffff'" stroke-width="1"
					/>
					<text :x="dot.cx" :y="dot.cy + 10"
						text-anchor="middle" font-size="5"
						:fill="isDark ? (dot.user.color || '#c4b5fd') : '#5b21b6'"
						font-family="Inter, sans-serif">
						{{ dot.user.name?.split(' ')[0]?.slice(0, 4) }}
					</text>
				</g>

				<!-- My position (pulsing) -->
				<g v-if="myDot">
					<circle :cx="myDot.cx" :cy="myDot.cy" r="7"
						fill="#f97316" stroke="white" stroke-width="1.5"
						class="my-dot-pulse"
					/>
					<text :x="myDot.cx" :y="myDot.cy + 13"
						text-anchor="middle" font-size="5.5" :fill="isDark ? '#fdba74' : '#c2410c'"
						font-weight="700" font-family="Inter, sans-serif">You</text>
				</g>

				<!-- Compass -->
				<text x="14" y="16" font-size="8" :fill="isDark ? '#4d6080' : '#4a6880'" font-family="Inter">N↑</text>
			</svg>

			<div class="fp-legend">
				<span class="leg-item">
					<span class="leg-dot" style="background:#f97316"></span> You
				</span>
				<span class="leg-item">
					<span class="leg-dot" style="background:#a78bfa"></span> Others
				</span>
				<span class="leg-tip">Click a room to navigate</span>
			</div>
		</div>
	</div>
</template>

<style scoped>
.floorplan-overlay {
	position: absolute;
	inset: 0;
	z-index: 45;
	display: flex;
	align-items: center;
	justify-content: center;
	pointer-events: auto;
}

.fp-backdrop {
	position: absolute;
	inset: 0;
	background: rgba(4, 8, 14, 0.75);
	backdrop-filter: blur(4px);
}

.fp-panel {
	position: relative;
	background: var(--color-card);
	border: 1px solid var(--color-brd);
	border-radius: 0.75rem;
	overflow: hidden;
	width: min(75rem, 78vw);
	max-height: 88vh;
	display: flex;
	flex-direction: column;
	box-shadow: 0 16px 64px rgba(0,0,0,0.6);
}

.fp-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 0.875rem 1.125rem;
	border-bottom: 1px solid var(--color-brd);
	background: var(--color-card2);
}

.fp-title {
	font-size: 0.875rem;
	font-weight: 700;
	color: var(--color-t1);
	letter-spacing: 0.04em;
}

.fp-close {
	background: none; border: none;
	color: var(--color-tm); cursor: pointer;
	font-size: 0.875rem; padding: 0.25rem;
	transition: color 0.15s;
}
.fp-close:hover { color: var(--color-t1); }

.fp-svg {
	display: block;
	width: 100%;
	flex: 1;
	min-height: 0;
	background: var(--fp-svg-bg, #060c14);
	cursor: pointer;
	overflow: auto;
}
:global(html.light) .fp-backdrop { background: rgba(180, 210, 240, 0.6); }

.room-group { cursor: pointer; transition: opacity 0.12s; }
.room-group:hover rect:first-child { stroke: #00b4d8 !important; }

.fp-legend {
	display: flex;
	align-items: center;
	gap: 1rem;
	padding: 0.625rem 1.125rem;
	border-top: 1px solid var(--color-brd);
	background: var(--color-card2);
}

.leg-item {
	display: flex; align-items: center; gap: 0.3125rem;
	font-size: 0.6875rem; color: var(--color-t2);
}
.leg-dot {
	display: inline-block; width: 0.5rem; height: 0.5rem; border-radius: 50%;
}
.leg-tip {
	margin-left: auto;
	font-size: 0.6875rem; color: var(--color-tm);
	font-style: italic;
}

@keyframes fp-pulse {
	0%, 100% { r: 7; opacity: 1; }
	50% { r: 10; opacity: 0.6; }
}
.my-dot-pulse { animation: fp-pulse 2s ease-in-out infinite; }
</style>
