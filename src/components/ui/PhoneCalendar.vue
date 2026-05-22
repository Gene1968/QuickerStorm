<script setup>
/**
 * PhoneCalendar — today's Google Calendar events, phone-styled.
 *
 * Two views: 'list' (today's schedule) and 'detail' (full event with
 * attendees + description with clickable links). Uses the same
 * useGoogleCalendar composable + CalendarApi as the desktop computer.
 */
import { ref, computed } from 'vue'
import {
	RefreshCw as ArrowPathIcon, ExternalLink as ArrowTopRightOnSquareIcon, Video as VideoCameraIcon,
	ChevronLeft as ChevronLeftIcon, MapPin as MapPinIcon, Users as UserGroupIcon, Clock as ClockIcon,
} from '@lucide/vue'
import { useGoogleCalendar } from '@/composables/useGoogleCalendar.js'
import { CalendarApi, startGoogleAuthPopup } from '@/api/GoogleApi.js'
import { sanitizeHtml, wrapAsIframeDoc, plainTextToHtml } from '@/utils/sanitizeBodyHtml.js'

const { events, currentEvent, nextEvent, isLoading, error, isAuthed, fetchEvents } = useGoogleCalendar()

const view = ref('list')          // 'list' | 'detail'
const selectedEvent = ref(null)

const todayLabel = computed(() => {
	const d = new Date()
	return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
})

function formatTime(dateStr) {
	if (!dateStr) return ''
	const d = new Date(dateStr)
	return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function formatRange(ev) {
	if (!ev?.start?.dateTime) return 'All day'
	return `${formatTime(ev.start.dateTime)} – ${formatTime(ev.end?.dateTime)}`
}

function isNow(event)  { return currentEvent.value?.id === event.id }
function isNext(event) { return nextEvent.value?.id === event.id }

function reconnect()    { startGoogleAuthPopup(() => fetchEvents()) }
function openExternal() { CalendarApi.openCalendar() }

function openEvent(ev) {
	selectedEvent.value = ev
	view.value = 'detail'
}
function backToList() {
	view.value = 'list'
	selectedEvent.value = null
}

// ── Description rendering (sandboxed; clickable links) ──────────────────
function descriptionHtml(desc) {
	if (!desc) return ''
	const looksLikeHtml = /<[a-z][\s\S]*>/i.test(desc)
	const body = looksLikeHtml ? sanitizeHtml(desc) : plainTextToHtml(desc)
	return wrapAsIframeDoc(body)
}

// ── Attendees ───────────────────────────────────────────────────────────
function attendeeName(a) {
	return a.displayName || a.email?.split('@')[0] || 'Guest'
}
function attendeeInitial(a) {
	return (attendeeName(a)[0] || '?').toUpperCase()
}
function attendeeColor(a) {
	const seed = a.email || a.displayName || 'x'
	let h = 0
	for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
	return `hsl(${h % 360}, 50%, 50%)`
}
function statusBadge(a) {
	switch (a.responseStatus) {
		case 'accepted':    return { label: '✓', cls: 'pc-rsvp-yes' }
		case 'declined':    return { label: '✕', cls: 'pc-rsvp-no' }
		case 'tentative':   return { label: '?', cls: 'pc-rsvp-maybe' }
		default:            return null
	}
}

// ── Location heuristics ─────────────────────────────────────────────────
// People stuff Zoom / Meet / Teams URLs into the "location" field. Detect
// those so we don't hand them off to Google Maps as a search query.
const MEETING_URL_RE = /(zoom\.us|meet\.google\.com|teams\.(microsoft|live)\.com|webex\.com|whereby\.com|jitsi)/i

function locationIsUrl(loc) { return /^\s*https?:\/\//i.test(loc || '') }
function locationIsMeeting(loc) { return locationIsUrl(loc) && MEETING_URL_RE.test(loc) }

function locationLink(loc) {
	if (locationIsUrl(loc)) return loc.trim()
	return `https://maps.google.com/?q=${encodeURIComponent(loc)}`
}

function locationSubtext(loc) {
	if (locationIsMeeting(loc)) return 'Tap to join'
	if (locationIsUrl(loc)) return 'Open link'
	return 'View on map'
}
</script>

<template>
	<div class="pc-cal">
		<!-- Not authenticated -->
		<div v-if="!isAuthed" class="pc-auth">
			<div class="pc-auth-icon">📅</div>
			<div class="pc-auth-title">Connect Calendar</div>
			<div class="pc-auth-sub">Sign in with Google to see your schedule.</div>
			<button class="pc-cta" @click="reconnect">Connect Google</button>
		</div>

		<!-- ── List view ──────────────────────────────────────────────── -->
		<template v-else-if="view === 'list'">
			<div class="pc-toolbar">
				<button class="pc-icon-btn" @click="fetchEvents" :disabled="isLoading" title="Refresh">
					<ArrowPathIcon class="pc-icon-svg" :class="{ spin: isLoading }" />
				</button>
				<div class="pc-toolbar-title">Today</div>
				<button class="pc-icon-btn" @click="openExternal" title="Open in Google Calendar">
					<ArrowTopRightOnSquareIcon class="pc-icon-svg" />
				</button>
			</div>

			<div class="pc-date-header">
				<div class="pc-date-day">{{ todayLabel }}</div>
				<div class="pc-date-sub" v-if="events.length">
					{{ events.length }} event{{ events.length === 1 ? '' : 's' }}
				</div>
			</div>

			<div v-if="error" class="pc-error">{{ error }}</div>

			<div class="pc-events">
				<div v-if="isLoading && !events.length" class="pc-state">Loading events…</div>
				<div v-else-if="!events.length" class="pc-state">Nothing scheduled today 🎉</div>
				<button
					v-for="event in events"
					:key="event.id"
					class="pc-event"
					:class="{ now: isNow(event), next: isNext(event) }"
					@click="openEvent(event)"
				>
					<div class="pc-event-time">
						<template v-if="event.start?.dateTime">
							<div class="pc-time-start">{{ formatTime(event.start.dateTime) }}</div>
							<div class="pc-time-end">{{ formatTime(event.end?.dateTime) }}</div>
						</template>
						<template v-else>
							<div class="pc-time-allday">All day</div>
						</template>
					</div>
					<div class="pc-event-bar"></div>
					<div class="pc-event-info">
						<div class="pc-event-title-row">
							<span class="pc-event-title">{{ event.summary || '(No title)' }}</span>
							<span v-if="isNow(event)" class="pc-badge now">Now</span>
							<span v-else-if="isNext(event)" class="pc-badge next">Next</span>
						</div>
						<div v-if="event.location" class="pc-event-location">📍 {{ event.location }}</div>
						<div v-if="event.attendees?.length" class="pc-event-meta">
							👥 {{ event.attendees.length }} attendee{{ event.attendees.length === 1 ? '' : 's' }}
						</div>
					</div>
					<a
						v-if="event.hangoutLink"
						:href="event.hangoutLink"
						target="_blank"
						rel="noopener"
						class="pc-join pc-join-inline"
						@click.stop
					>
						<VideoCameraIcon class="pc-join-icon" />
						Join
					</a>
				</button>
			</div>
		</template>

		<!-- ── Detail view ────────────────────────────────────────────── -->
		<template v-else-if="view === 'detail' && selectedEvent">
			<div class="pc-toolbar">
				<button class="pc-icon-btn" @click="backToList" title="Back">
					<ChevronLeftIcon class="pc-icon-svg" />
				</button>
				<div class="pc-toolbar-title">Event</div>
				<a
					v-if="selectedEvent.htmlLink"
					:href="selectedEvent.htmlLink"
					target="_blank"
					rel="noopener"
					class="pc-icon-btn pc-icon-link"
					title="Open in Google Calendar"
				>
					<ArrowTopRightOnSquareIcon class="pc-icon-svg" />
				</a>
			</div>

			<div class="pc-detail">
				<div class="pc-detail-header">
					<div class="pc-detail-title-row">
						<span class="pc-detail-title">{{ selectedEvent.summary || '(No title)' }}</span>
						<span v-if="isNow(selectedEvent)" class="pc-badge now">Now</span>
						<span v-else-if="isNext(selectedEvent)" class="pc-badge next">Next</span>
					</div>

					<div class="pc-detail-row">
						<ClockIcon class="pc-detail-icon" />
						<div class="pc-detail-text">
							<div>{{ todayLabel }}</div>
							<div class="pc-detail-sub">{{ formatRange(selectedEvent) }}</div>
						</div>
					</div>

					<a
						v-if="selectedEvent.hangoutLink"
						:href="selectedEvent.hangoutLink"
						target="_blank"
						rel="noopener"
						class="pc-join"
					>
						<VideoCameraIcon class="pc-join-icon" />
						Join meeting
					</a>
				</div>

				<a
					v-if="selectedEvent.location"
					:href="locationLink(selectedEvent.location)"
					target="_blank"
					rel="noopener"
					class="pc-detail-row pc-detail-row--link"
				>
					<VideoCameraIcon v-if="locationIsMeeting(selectedEvent.location)" class="pc-detail-icon" />
					<MapPinIcon v-else class="pc-detail-icon" />
					<div class="pc-detail-text">
						<div :class="{ 'pc-link-text': locationIsUrl(selectedEvent.location) }">
							{{ selectedEvent.location }}
						</div>
						<div class="pc-detail-sub">{{ locationSubtext(selectedEvent.location) }}</div>
					</div>
				</a>

				<div v-if="selectedEvent.attendees?.length" class="pc-detail-section">
					<div class="pc-detail-section-head">
						<UserGroupIcon class="pc-detail-icon" />
						<span class="pc-detail-section-title">Attendees ({{ selectedEvent.attendees.length }})</span>
					</div>
					<div class="pc-attendees">
						<div v-for="(a, i) in selectedEvent.attendees" :key="i" class="pc-attendee">
							<span class="pc-attendee-avatar" :style="{ background: attendeeColor(a) }">
								{{ attendeeInitial(a) }}
							</span>
							<div class="pc-attendee-text">
								<div class="pc-attendee-name">{{ attendeeName(a) }}</div>
								<div v-if="a.email && a.displayName" class="pc-attendee-email">{{ a.email }}</div>
							</div>
							<span v-if="statusBadge(a)" class="pc-rsvp" :class="statusBadge(a).cls">
								{{ statusBadge(a).label }}
							</span>
						</div>
					</div>
				</div>

				<div v-if="selectedEvent.description" class="pc-detail-section">
					<div class="pc-detail-section-head">
						<span class="pc-detail-section-title">Description</span>
					</div>
					<iframe
						class="pc-desc-iframe"
						:srcdoc="descriptionHtml(selectedEvent.description)"
						sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
						referrerpolicy="no-referrer"
					></iframe>
				</div>
			</div>
		</template>
	</div>
</template>

<style scoped>
.pc-cal {
	flex: 1;
	display: flex;
	flex-direction: column;
	background: #f8fafc;
	color: #0f172a;
	overflow: hidden;
	font-size: 0.8125rem;
}

/* Auth */
.pc-auth {
	flex: 1;
	display: flex; flex-direction: column;
	align-items: center; justify-content: center;
	gap: 0.5rem;
	padding: 1.5rem;
	text-align: center;
}
.pc-auth-icon { font-size: 2.25rem; }
.pc-auth-title { font-size: 1rem; font-weight: 600; color: #0f172a; }
.pc-auth-sub { font-size: 0.75rem; color: #64748b; margin-bottom: 0.5rem; }
.pc-cta {
	padding: 0.5rem 1rem;
	border-radius: 0.5rem;
	border: none;
	background: #dc2626;
	color: #fff;
	font-size: 0.8125rem;
	font-weight: 600;
	cursor: pointer;
}
.pc-cta:hover { background: #b91c1c; }

/* Toolbar */
.pc-toolbar {
	display: flex; align-items: center;
	gap: 0.5rem;
	padding: 0.5rem 0.625rem;
	background: #ffffff;
	border-bottom: 1px solid #e2e8f0;
	flex-shrink: 0;
}
.pc-toolbar-title {
	flex: 1;
	font-size: 0.875rem;
	font-weight: 600;
	color: #0f172a;
	text-align: center;
}
.pc-icon-btn {
	width: 2rem; height: 2rem;
	display: flex; align-items: center; justify-content: center;
	border: none;
	background: none;
	color: #dc2626;
	cursor: pointer;
	border-radius: 0.375rem;
	text-decoration: none;
}
.pc-icon-btn:hover:not(:disabled) { background: #fef2f2; }
.pc-icon-btn:disabled { color: #cbd5e1; cursor: default; }
.pc-icon-link { color: #2563eb; }
.pc-icon-link:hover { background: #eff6ff; }
.pc-icon-svg { width: 1.125rem; height: 1.125rem; }
.pc-icon-svg.spin { animation: pc-spin 0.8s linear infinite; }
@keyframes pc-spin { to { transform: rotate(360deg); } }

/* Date header */
.pc-date-header {
	padding: 0.625rem 0.875rem;
	background: #ffffff;
	border-bottom: 1px solid #f1f5f9;
}
.pc-date-day {
	font-size: 0.875rem;
	font-weight: 700;
	color: #0f172a;
}
.pc-date-sub {
	font-size: 0.6875rem;
	color: #64748b;
	margin-top: 0.0625rem;
}

/* Error / state */
.pc-error {
	padding: 0.5rem 0.75rem;
	background: #fef2f2;
	color: #991b1b;
	font-size: 0.6875rem;
	border-bottom: 1px solid #fecaca;
}
.pc-state {
	padding: 2rem 1rem;
	text-align: center;
	font-size: 0.75rem;
	color: #94a3b8;
	font-style: italic;
}

/* Events list */
.pc-events {
	flex: 1;
	overflow-y: auto;
	background: #ffffff;
	padding: 0.25rem 0;
}
.pc-event {
	width: 100%;
	display: flex;
	align-items: stretch;
	gap: 0.5rem;
	padding: 0.5rem 0.875rem;
	border: none;
	background: none;
	border-bottom: 1px solid #f1f5f9;
	cursor: pointer;
	text-align: left;
	font-family: inherit;
	color: inherit;
	font-size: inherit;
}
.pc-event:hover { background: #f8fafc; }
.pc-event.now { background: #fef9c3; }
.pc-event.now:hover { background: #fef08a; }

.pc-event-time {
	flex-shrink: 0;
	width: 3.25rem;
	display: flex; flex-direction: column;
	justify-content: flex-start;
	font-variant-numeric: tabular-nums;
}
.pc-time-start { font-size: 0.75rem; font-weight: 600; color: #0f172a; }
.pc-time-end { font-size: 0.625rem; color: #64748b; }
.pc-time-allday { font-size: 0.625rem; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }

.pc-event-bar {
	width: 0.1875rem;
	border-radius: 0.125rem;
	background: #cbd5e1;
	flex-shrink: 0;
}
.pc-event.now  .pc-event-bar { background: #dc2626; }
.pc-event.next .pc-event-bar { background: #f59e0b; }

.pc-event-info {
	flex: 1; min-width: 0;
	display: flex; flex-direction: column;
	gap: 0.125rem;
}
.pc-event-title-row {
	display: flex; align-items: center;
	gap: 0.375rem;
	flex-wrap: wrap;
}
.pc-event-title {
	font-size: 0.8125rem;
	font-weight: 600;
	color: #0f172a;
}
.pc-event-location, .pc-event-meta {
	font-size: 0.6875rem;
	color: #64748b;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.pc-badge {
	font-size: 0.5625rem;
	font-weight: 700;
	padding: 0.0625rem 0.375rem;
	border-radius: 0.5rem;
	letter-spacing: 0.04em;
	text-transform: uppercase;
}
.pc-badge.now  { background: #dc2626; color: #fff; }
.pc-badge.next { background: #fef3c7; color: #92400e; }

.pc-join {
	display: inline-flex;
	align-items: center;
	gap: 0.25rem;
	padding: 0.375rem 0.75rem;
	background: #2563eb;
	color: #fff;
	font-size: 0.75rem;
	font-weight: 600;
	border-radius: 0.5rem;
	text-decoration: none;
}
.pc-join:hover { background: #1d4ed8; }
.pc-join-icon { width: 0.875rem; height: 0.875rem; }
.pc-join-inline {
	align-self: center;
	padding: 0.25rem 0.5rem;
	font-size: 0.6875rem;
	flex-shrink: 0;
}

/* ── Detail view ────────────────────────────────────────────────────── */
.pc-detail {
	flex: 1;
	overflow-y: auto;
	background: #ffffff;
}
.pc-detail-header {
	padding: 0.875rem 1rem;
	border-bottom: 1px solid #f1f5f9;
	display: flex; flex-direction: column;
	gap: 0.625rem;
}
.pc-detail-title-row {
	display: flex; align-items: flex-start;
	gap: 0.5rem;
	flex-wrap: wrap;
}
.pc-detail-title {
	font-size: 1.0625rem;
	font-weight: 700;
	color: #0f172a;
	flex: 1;
	line-height: 1.3;
	word-wrap: break-word;
}

.pc-detail-row {
	display: flex; align-items: flex-start;
	gap: 0.625rem;
	padding: 0.625rem 1rem;
	border-bottom: 1px solid #f1f5f9;
	color: #0f172a;
	text-decoration: none;
}
.pc-detail-row--link {
	cursor: pointer;
}
.pc-detail-row--link:hover { background: #f8fafc; }
.pc-link-text { color: #2563eb; word-break: break-all; }
.pc-detail-row.pc-detail-row {
	/* (no extra margin override needed — keeping tight stacked rows) */
}
.pc-detail-icon {
	flex-shrink: 0;
	width: 1rem; height: 1rem;
	color: #64748b;
	margin-top: 0.125rem;
}
.pc-detail-text { flex: 1; min-width: 0; font-size: 0.8125rem; }
.pc-detail-sub { font-size: 0.6875rem; color: #64748b; margin-top: 0.0625rem; }

.pc-detail-header .pc-detail-row { padding: 0; border: none; }
.pc-detail-header .pc-join { align-self: flex-start; }

.pc-detail-section {
	padding: 0.625rem 1rem;
	border-bottom: 1px solid #f1f5f9;
}
.pc-detail-section-head {
	display: flex; align-items: center;
	gap: 0.375rem;
	margin-bottom: 0.375rem;
}
.pc-detail-section-title {
	font-size: 0.625rem;
	font-weight: 700;
	color: #64748b;
	text-transform: uppercase;
	letter-spacing: 0.06em;
}

/* Attendees */
.pc-attendees {
	display: flex; flex-direction: column;
	gap: 0.375rem;
}
.pc-attendee {
	display: flex; align-items: center;
	gap: 0.5rem;
}
.pc-attendee-avatar {
	flex-shrink: 0;
	width: 1.75rem; height: 1.75rem;
	border-radius: 50%;
	display: flex; align-items: center; justify-content: center;
	color: #fff;
	font-size: 0.6875rem;
	font-weight: 600;
}
.pc-attendee-text { flex: 1; min-width: 0; }
.pc-attendee-name {
	font-size: 0.75rem; font-weight: 500; color: #0f172a;
	overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.pc-attendee-email {
	font-size: 0.625rem; color: #64748b;
	overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.pc-rsvp {
	flex-shrink: 0;
	width: 1.125rem; height: 1.125rem;
	border-radius: 50%;
	display: flex; align-items: center; justify-content: center;
	font-size: 0.6875rem;
	font-weight: 700;
	color: #fff;
}
.pc-rsvp-yes   { background: #16a34a; }
.pc-rsvp-no    { background: #dc2626; }
.pc-rsvp-maybe { background: #f59e0b; }

/* Description iframe */
.pc-desc-iframe {
	width: 100%;
	min-height: 8rem;
	max-height: 18rem;
	border: none;
	background: #fff;
	display: block;
}
</style>
