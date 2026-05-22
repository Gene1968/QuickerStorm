<script setup>
/**
 * PhoneOverlay — a phone-shaped centered modal that gives users access to
 * their mail, calendar, whiteboards, docs, and task boards from anywhere
 * (no need to be in a meeting room to find a board they're a member of).
 *
 * Mail / Calendar route to Google via the user's googleAccountIndex.
 * Whiteboards / Docs / Tasks list every collab_doc the user can access
 * (active + archived) via the WS `list-mine` permission action, and
 * dispatch `ava-collab-open` so OfficeView mounts the right overlay.
 *
 * Phase 1: 2D overlay only. Phases 2/3 will add the 3D phone-in-hand pose
 * and the iPhone vs Android style picker.
 */
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import {
	X as XMarkIcon, ChevronLeft as ChevronLeftIcon,
	Mail as EnvelopeIcon, Calendar as CalendarDaysIcon, PenSquare as PencilSquareIcon, FileText as DocumentTextIcon, ClipboardList as ClipboardDocumentListIcon,
	Lock as LockClosedIcon, Archive as ArchiveBoxIcon,
} from '@lucide/vue'
import { useAvatarStore } from '@/stores/avatarStore.js'
import { useRealtimeSocket } from '@/composables/useRealtimeSocket.js'
import { ALL_ROOMS } from '@/config/officeLayout.js'
import PhoneMail from '@/components/ui/PhoneMail.vue'
import PhoneCalendar from '@/components/ui/PhoneCalendar.vue'

const emit = defineEmits(['close'])

const avatarStore = useAvatarStore()
const ws = useRealtimeSocket()

const screen = ref('home')   // 'home' | 'mail' | 'calendar' | 'whiteboards' | 'docs' | 'tasks'

const APPS = [
	{ key: 'mail',        label: 'Mail',        icon: EnvelopeIcon,                color: '#3b82f6' },
	{ key: 'calendar',    label: 'Calendar',    icon: CalendarDaysIcon,            color: '#dc2626' },
	{ key: 'whiteboards', label: 'Whiteboards', icon: PencilSquareIcon,            color: '#8b5cf6' },
	{ key: 'docs',        label: 'Docs',        icon: DocumentTextIcon,            color: '#2563eb' },
	{ key: 'tasks',       label: 'Tasks',       icon: ClipboardDocumentListIcon,   color: '#059669' },
]

// ── Live clock for the phone status bar ─────────────────────────────────
const now = ref(new Date())
let _clock = null
onMounted(() => { _clock = setInterval(() => { now.value = new Date() }, 30_000) })
onUnmounted(() => { if (_clock) clearInterval(_clock) })

const clockLabel = computed(() => {
	const d = now.value
	const h = d.getHours()
	const m = d.getMinutes().toString().padStart(2, '0')
	const ampm = h >= 12 ? 'PM' : 'AM'
	const h12 = ((h + 11) % 12) + 1
	return `${h12}:${m} ${ampm}`
})

// Mail and Calendar render inline via PhoneMail / PhoneCalendar (same Google
// APIs as the desktop computer). External-link helpers no longer needed here.

// ── List-mine fetch ─────────────────────────────────────────────────────
const docs = ref([])           // raw rows from server
const loading = ref(false)
const fetchError = ref(null)

function loadList() {
	loading.value = true
	fetchError.value = null
	function handler(data) {
		if (data.action !== 'list-mine') return
		ws.off('ypr', handler)
		loading.value = false
		if (data.ok) docs.value = Array.isArray(data.data) ? data.data : []
		else fetchError.value = data.error || 'Failed to load'
	}
	ws.on('ypr', handler)
	ws.emit('yp', { docId: null, action: 'list-mine' })
}

// Lazy-load the list the first time the user opens any of the doc apps.
watch(screen, (s) => {
	if (s === 'whiteboards' || s === 'docs' || s === 'tasks') {
		if (!docs.value.length && !loading.value) loadList()
	}
})

function refresh() { loadList() }

// ── Doc-list helpers ────────────────────────────────────────────────────
const docsByType = computed(() => ({
	whiteboard: docs.value.filter(d => d.type === 'whiteboard'),
	doc:        docs.value.filter(d => d.type === 'doc'),
	taskboard:  docs.value.filter(d => d.type === 'taskboard'),
}))

function listFor(screenKey) {
	const map = { whiteboards: 'whiteboard', docs: 'doc', tasks: 'taskboard' }
	const t = map[screenKey]
	const list = (docsByType.value[t] || []).slice()
	// Active first, then archived (most recently updated first within each).
	list.sort((a, b) => {
		if (!!a.archived !== !!b.archived) return a.archived ? 1 : -1
		return (b.updated_at || '').localeCompare(a.updated_at || '')
	})
	return list
}

const ROOM_LABELS = Object.fromEntries((ALL_ROOMS || []).map(r => [r.id, r.label || r.id]))

function roomLabel(id) {
	return ROOM_LABELS[id] || id
}

function formatDate(s) {
	if (!s) return ''
	const d = new Date(s)
	return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function openDoc(d) {
	window.dispatchEvent(new CustomEvent('ava-collab-open', {
		detail: { type: d.type, docId: d.id, roomId: d.room_id },
	}))
	emit('close')
}

// Esc to close
function onKey(e) {
	if (e.key === 'Escape') {
		if (screen.value !== 'home') screen.value = 'home'
		else emit('close')
	}
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))

const screenTitle = computed(() => {
	const a = APPS.find(x => x.key === screen.value)
	return a ? a.label : ''
})

const screenIcon = computed(() => {
	const a = APPS.find(x => x.key === screen.value)
	return a ? a.icon : null
})
</script>

<template>
	<div class="ph-backdrop" @mousedown.self="emit('close')">
		<div class="ph-frame" @mousedown.stop>
			<!-- Speaker / camera notch -->
			<div class="ph-notch"></div>

			<!-- Status bar -->
			<div class="ph-status">
				<span class="ph-time">{{ clockLabel }}</span>
				<span class="ph-icons">
					<span class="ph-signal"></span>
					<span class="ph-wifi"></span>
					<span class="ph-battery"></span>
				</span>
			</div>

			<!-- Screen -->
			<div class="ph-screen">
				<!-- Home -->
				<template v-if="screen === 'home'">
					<div class="ph-greeting">
						<div class="ph-greet-name">Hi, {{ avatarStore.displayName?.split(' ')[0] || 'there' }}</div>
						<div class="ph-greet-sub">Tap an app to get started</div>
					</div>
					<div class="ph-grid">
						<button
							v-for="app in APPS"
							:key="app.key"
							class="ph-app"
							@click="screen = app.key"
						>
							<span class="ph-app-icon" :style="{ background: app.color }">
								<component :is="app.icon" class="ph-icon" />
							</span>
							<span class="ph-app-label">{{ app.label }}</span>
						</button>
					</div>
				</template>

				<!-- App view header -->
				<template v-else>
					<div class="ph-app-header">
						<button class="ph-back" @click="screen = 'home'" title="Back">
							<ChevronLeftIcon class="ph-back-icon" />
						</button>
						<div class="ph-app-title">
							<component :is="screenIcon" class="ph-app-title-icon" />
							{{ screenTitle }}
						</div>
						<button v-if="screen !== 'mail' && screen !== 'calendar'" class="ph-back" @click="refresh" title="Refresh">↻</button>
						<span v-else class="ph-back-spacer"></span>
					</div>

					<!-- Mail (uses Gmail API, same as the desktop computer) -->
					<div v-if="screen === 'mail'" class="ph-app-body ph-app-body--flush">
						<PhoneMail />
					</div>

					<!-- Calendar (uses Google Calendar API, same as the desktop computer) -->
					<div v-else-if="screen === 'calendar'" class="ph-app-body ph-app-body--flush">
						<PhoneCalendar />
					</div>

					<!-- Whiteboards / Docs / Tasks share the same list view -->
					<div v-else class="ph-app-body">
						<div v-if="loading" class="ph-empty">Loading...</div>
						<div v-else-if="fetchError" class="ph-empty">{{ fetchError }}</div>
						<div v-else-if="!listFor(screen).length" class="ph-empty">
							Nothing here yet. Open a meeting room and create one.
						</div>
						<button
							v-for="d in listFor(screen)"
							:key="d.id"
							class="ph-row"
							:class="{ archived: d.archived }"
							@click="openDoc(d)"
						>
							<span class="ph-row-icon">
								<LockClosedIcon v-if="d.archived && d.locked" class="ph-row-svg" />
								<ArchiveBoxIcon v-else-if="d.archived" class="ph-row-svg" />
								<component v-else :is="screenIcon" class="ph-row-svg" />
							</span>
							<span class="ph-row-text">
								<span class="ph-row-title">{{ d.title || 'Untitled' }}</span>
								<span class="ph-row-meta">
									<span>{{ roomLabel(d.room_id) }}</span>
									<span v-if="d.archived && d.locked">· archived</span>
									<span v-else-if="d.archived">· saved</span>
									<span>· {{ formatDate(d.archived_at || d.updated_at) }}</span>
								</span>
							</span>
						</button>
					</div>
				</template>
			</div>

			<!-- Home indicator + close affordance -->
			<button class="ph-home" @click="screen === 'home' ? emit('close') : (screen = 'home')" :title="screen === 'home' ? 'Close' : 'Home'">
				<XMarkIcon v-if="screen === 'home'" class="ph-home-icon" />
				<span v-else class="ph-home-bar"></span>
			</button>
		</div>
	</div>
</template>

<style scoped>
.ph-backdrop {
	position: fixed; inset: 0;
	display: flex; align-items: center; justify-content: center;
	background: rgba(4, 10, 20, 0.6);
	backdrop-filter: blur(4px);
	z-index: 650;
}

.ph-frame {
	position: relative;
	width: 22rem;
	max-width: 92vw;
	height: 42rem;
	max-height: 90vh;
	background: #0b1220;
	border-radius: 2.25rem;
	border: 0.4rem solid #0f172a;
	box-shadow:
		0 1.5rem 3rem rgba(0, 0, 0, 0.55),
		inset 0 0 0 1px rgba(255, 255, 255, 0.05);
	display: flex; flex-direction: column;
	overflow: hidden;
	color: var(--color-t1);
}

.ph-notch {
	position: absolute;
	top: 0;
	left: 50%; transform: translateX(-50%);
	width: 6rem; height: 1.1rem;
	background: #0f172a;
	border-bottom-left-radius: 0.875rem;
	border-bottom-right-radius: 0.875rem;
	z-index: 2;
}

.ph-status {
	display: flex; align-items: center; justify-content: space-between;
	padding: 0.5rem 1.25rem 0.25rem;
	font-size: 0.6875rem;
	font-weight: 600;
	color: #f1f5f9;
}
.ph-time { font-variant-numeric: tabular-nums; }
.ph-icons { display: flex; gap: 0.375rem; align-items: center; }
.ph-signal::before { content: '••••'; letter-spacing: -0.05em; }
.ph-wifi::before { content: '◗'; }
.ph-battery {
	display: inline-block;
	width: 1.25rem; height: 0.625rem;
	border: 1px solid #cbd5e1;
	border-radius: 0.1875rem;
	position: relative;
}
.ph-battery::after {
	content: ''; position: absolute;
	top: 0.0625rem; bottom: 0.0625rem; left: 0.0625rem;
	width: 0.875rem;
	background: #cbd5e1;
	border-radius: 0.0625rem;
}

.ph-screen {
	flex: 1;
	background: linear-gradient(180deg, #0b1220 0%, #1e293b 100%);
	overflow-y: auto;
	overflow-x: hidden;
	display: flex; flex-direction: column;
}

/* ── Home ────────────────────────────────────────────────────────────── */
.ph-greeting {
	padding: 1rem 1.5rem 0.5rem;
	color: #f1f5f9;
}
.ph-greet-name { font-size: 1.125rem; font-weight: 600; }
.ph-greet-sub { font-size: 0.75rem; color: #94a3b8; margin-top: 0.125rem; }

.ph-grid {
	display: grid;
	grid-template-columns: repeat(3, 1fr);
	gap: 0.75rem 0.625rem;
	padding: 1rem 1.25rem;
}
.ph-app {
	display: flex; flex-direction: column; align-items: center;
	gap: 0.375rem;
	background: none; border: none;
	cursor: pointer;
	color: inherit;
	padding: 0.25rem;
}
.ph-app-icon {
	width: 3.25rem; height: 3.25rem;
	border-radius: 0.875rem;
	display: flex; align-items: center; justify-content: center;
	box-shadow:
		inset 0 0.0625rem 0 rgba(255, 255, 255, 0.25),
		0 0.5rem 1rem rgba(0, 0, 0, 0.35);
	transition: transform 0.12s;
}
.ph-app:hover .ph-app-icon { transform: scale(1.05); }
.ph-app:active .ph-app-icon { transform: scale(0.95); }
.ph-icon { width: 1.5rem; height: 1.5rem; color: #fff; }
.ph-app-label {
	font-size: 0.6875rem;
	color: #f1f5f9;
	text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
}

/* ── App view ────────────────────────────────────────────────────────── */
.ph-app-header {
	display: flex; align-items: center; gap: 0.5rem;
	padding: 0.5rem 0.75rem;
	border-bottom: 1px solid rgba(255, 255, 255, 0.08);
	flex-shrink: 0;
}
.ph-back, .ph-back-spacer {
	width: 1.75rem; height: 1.75rem;
	display: flex; align-items: center; justify-content: center;
	border-radius: 50%;
	border: none;
	background: rgba(255, 255, 255, 0.08);
	color: #f1f5f9;
	cursor: pointer;
	font-size: 0.875rem;
}
.ph-back-spacer { background: none; }
.ph-back:hover { background: rgba(255, 255, 255, 0.16); }
.ph-back-icon { width: 1rem; height: 1rem; }
.ph-app-title {
	flex: 1;
	display: flex; align-items: center; gap: 0.375rem;
	font-size: 0.875rem;
	font-weight: 600;
	color: #f1f5f9;
}
.ph-app-title-icon { width: 1rem; height: 1rem; }

.ph-app-body {
	flex: 1; overflow-y: auto;
	padding: 0.75rem;
	display: flex; flex-direction: column;
	gap: 0.375rem;
}
/* No padding/gap when an embedded app (e.g. PhoneMail) draws its own chrome edge-to-edge. */
.ph-app-body--flush { padding: 0; gap: 0; overflow: hidden; }

.ph-card {
	background: rgba(255, 255, 255, 0.05);
	border: 1px solid rgba(255, 255, 255, 0.08);
	border-radius: 0.75rem;
	padding: 1rem;
	display: flex; flex-direction: column;
	align-items: center;
	gap: 0.5rem;
	color: #f1f5f9;
}
.ph-card-icon { width: 2rem; height: 2rem; color: #93c5fd; }
.ph-card-title { font-size: 1rem; font-weight: 600; }
.ph-card-sub { font-size: 0.75rem; color: #94a3b8; }
.ph-cta {
	margin-top: 0.5rem;
	padding: 0.5rem 1rem;
	border-radius: 0.5rem;
	border: none;
	background: var(--color-accent);
	color: #fff;
	font-size: 0.8125rem;
	font-weight: 600;
	cursor: pointer;
}
.ph-cta:hover { background: var(--color-accent2); }
.ph-hint {
	font-size: 0.6875rem;
	color: #94a3b8;
	margin: 0.5rem 0 0;
	text-align: center;
}

.ph-empty {
	padding: 1.5rem 0.75rem;
	text-align: center;
	font-size: 0.75rem;
	color: #94a3b8;
	font-style: italic;
}

.ph-row {
	width: 100%;
	display: flex; align-items: center;
	gap: 0.625rem;
	padding: 0.5rem 0.625rem;
	border-radius: 0.5rem;
	background: rgba(255, 255, 255, 0.04);
	border: 1px solid transparent;
	color: #f1f5f9;
	cursor: pointer;
	text-align: left;
	transition: background 0.12s, border-color 0.12s;
}
.ph-row:hover { background: rgba(255, 255, 255, 0.08); border-color: rgba(255, 255, 255, 0.12); }
.ph-row.archived { opacity: 0.75; }
.ph-row-icon {
	flex-shrink: 0;
	width: 1.875rem; height: 1.875rem;
	border-radius: 0.5rem;
	display: flex; align-items: center; justify-content: center;
	background: rgba(0, 180, 216, 0.18);
	color: var(--color-accent3);
}
.ph-row-svg { width: 1rem; height: 1rem; }
.ph-row-text {
	flex: 1; min-width: 0;
	display: flex; flex-direction: column;
	gap: 0.0625rem;
}
.ph-row-title {
	font-size: 0.8125rem;
	font-weight: 500;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.ph-row-meta {
	font-size: 0.625rem;
	color: #94a3b8;
	display: flex; gap: 0.25rem; flex-wrap: wrap;
}

/* ── Home indicator / close ──────────────────────────────────────────── */
.ph-home {
	position: relative;
	height: 1.5rem;
	background: #0b1220;
	border: none;
	display: flex; align-items: center; justify-content: center;
	cursor: pointer;
	color: #f1f5f9;
	flex-shrink: 0;
}
.ph-home-icon { width: 0.875rem; height: 0.875rem; }
.ph-home-bar {
	display: block;
	width: 6rem; height: 0.25rem;
	border-radius: 0.125rem;
	background: #cbd5e1;
}
.ph-home:hover .ph-home-bar { background: #fff; }
</style>
