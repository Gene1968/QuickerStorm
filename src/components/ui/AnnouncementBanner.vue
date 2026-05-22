<script setup>
import { watch, computed } from 'vue'
import { activeAnnouncement, dismissAnnouncement, snoozeAnnouncement } from '@/composables/useAnnouncements.js'
import { useAudio } from '@/composables/useAudio.js'
import { useOfficeStore } from '@/stores/officeStore.js'

const officeStore = useOfficeStore()
const { playAnnouncementBell } = useAudio()

function formatTime(iso) {
	if (!iso) return ''
	const d = new Date(iso)
	if (isNaN(d)) return ''
	const diffMs = Date.now() - d.getTime()
	const diffMin = Math.floor(diffMs / 60000)
	if (diffMin < 1)  return 'just now'
	if (diffMin < 60) return `${diffMin}m ago`
	return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

const ann = computed(() => activeAnnouncement.value)

watch(ann, (val) => {
	if (val) playAnnouncementBell()
})

function goThere() {
	if (!ann.value) return
	officeStore.navigateTo(ann.value.roomId)
	dismissAnnouncement(ann.value.id)
}
</script>

<template>
	<Transition name="ann-slide">
		<div v-if="ann" class="ann-banner">
			<div class="ann-icon">📣</div>
			<div class="ann-body">
				<div class="ann-from">
				{{ ann.sentBy }} — Meeting announcement
				<span v-if="ann.sentAt" class="ann-time">· {{ formatTime(ann.sentAt) }}</span>
			</div>
				<div class="ann-msg">{{ ann.message }}</div>
			</div>
			<div class="ann-actions">
				<button class="ann-go" @click="goThere">Go there now</button>
				<button class="ann-snooze" @click="snoozeAnnouncement(ann.id)">Snooze 5 min</button>
			</div>
			<button class="ann-close" @click="dismissAnnouncement(ann.id)" title="Dismiss">✕</button>
		</div>
	</Transition>
</template>

<style scoped>
.ann-banner {
	position: fixed;
	top: 1rem;
	left: calc(50% + var(--canvas-left) / 2);
	transform: translateX(-50%);
	z-index: 910;
	display: flex;
	align-items: center;
	gap: 0.875rem;
	padding: 0.75rem 1rem;
	background: var(--color-card);
	border: 1px solid var(--color-brd2);
	border-radius: 0.75rem;
	box-shadow: 0 8px 32px rgba(0, 0, 0, 0.55);
	backdrop-filter: blur(10px);
	max-width: clamp(20rem, 40vw, 36rem);
	width: max-content;
}

.ann-icon {
	font-size: 1.5rem;
	flex-shrink: 0;
	line-height: 1;
}

.ann-body {
	flex: 1;
	min-width: 0;
}

.ann-from {
	font-size: 0.6875rem;
	font-weight: 600;
	color: var(--color-tm);
	text-transform: uppercase;
	letter-spacing: 0.06em;
	margin-bottom: 0.1875rem;
}
.ann-time {
	font-weight: 400;
	opacity: 0.75;
}

.ann-msg {
	font-size: clamp(0.8125rem, 0.85vw, 0.9375rem);
	font-weight: 500;
	color: var(--color-t1);
	line-height: 1.4;
}

.ann-actions {
	display: flex;
	flex-direction: column;
	gap: 0.375rem;
	flex-shrink: 0;
}

.ann-go,
.ann-snooze {
	border: none;
	border-radius: 0.4rem;
	padding: 0.3125rem 0.75rem;
	font-size: 0.75rem;
	font-weight: 600;
	cursor: pointer;
	white-space: nowrap;
	transition: opacity 0.15s, background 0.15s;
}

.ann-go {
	background: var(--color-accent);
	color: #fff;
}
.ann-go:hover { opacity: 0.88; }

.ann-snooze {
	background: rgba(255, 255, 255, 0.08);
	color: var(--color-t2);
	border: 1px solid var(--color-brd);
}
.ann-snooze:hover { background: rgba(255, 255, 255, 0.14); color: var(--color-t1); }

.ann-close {
	flex-shrink: 0;
	background: none;
	border: none;
	color: var(--color-tm);
	font-size: 0.875rem;
	cursor: pointer;
	padding: 0.25rem;
	line-height: 1;
	border-radius: 0.25rem;
	transition: color 0.12s;
	align-self: flex-start;
}
.ann-close:hover { color: var(--color-t1); }

/* Slide-in from top */
.ann-slide-enter-active { transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.25s ease; }
.ann-slide-leave-active { transition: transform 0.2s ease, opacity 0.2s ease; }
.ann-slide-enter-from { transform: translateX(-50%) translateY(-120%); opacity: 0; }
.ann-slide-leave-to  { transform: translateX(-50%) translateY(-120%); opacity: 0; }

/* Light mode */
:global(html.light) .ann-go {
	background: var(--color-accent, #0057b3);
}
:global(html.light) .ann-snooze {
	background: rgba(0, 0, 0, 0.06);
	color: var(--color-t2);
}
:global(html.light) .ann-snooze:hover {
	background: rgba(0, 0, 0, 0.11);
}
</style>
