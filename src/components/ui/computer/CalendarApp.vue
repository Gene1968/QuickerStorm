<script setup>
/**
 * CalendarApp — Calendar tab inside the ComputerScreen overlay.
 * Reuses the existing useGoogleCalendar composable.
 */
import { useGoogleCalendar } from '@/composables/useGoogleCalendar.js'
import { CalendarApi, startGoogleAuthPopup } from '@/api/GoogleApi.js'

const { events, currentEvent, nextEvent, isLoading, error, isAuthed } = useGoogleCalendar()

function formatTime (dateStr) {
	if (!dateStr) return ''
	const d = new Date(dateStr)
	return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function isNow (event) {
	return currentEvent.value?.id === event.id
}
function isNext (event) {
	return nextEvent.value?.id === event.id
}

function openCalendar () {
	CalendarApi.openCalendar()
}

function reconnect () {
	startGoogleAuthPopup(() => {})
}
</script>

<template>
	<div class="cal-app">
		<!-- Not authenticated -->
		<div v-if="!isAuthed" class="cal-auth">
			<div class="cal-auth-inner">
				<span class="cal-auth-icon">&#128197;</span>
				<h3>Connect Calendar</h3>
				<p>Sign in with Google to see your schedule.</p>
				<button class="cal-btn primary" @click="reconnect">Connect Google</button>
			</div>
		</div>

		<template v-else>
			<div class="cal-toolbar">
				<h3 class="cal-title">Today's Schedule</h3>
				<button class="cal-btn" @click="openCalendar">Open Google Calendar</button>
			</div>

			<div v-if="error" class="cal-error">{{ error }}</div>

			<div class="cal-events">
				<div v-if="isLoading" class="cal-loading">Loading events...</div>
				<div v-else-if="!events.length" class="cal-empty">No events today</div>
				<div
					v-for="event in events"
					:key="event.id"
					class="cal-event"
					:class="{ now: isNow(event), next: isNext(event) }"
				>
					<div class="cal-event-time">
						<template v-if="event.start?.dateTime">
							{{ formatTime(event.start.dateTime) }}
							<span class="cal-event-dash">&ndash;</span>
							{{ formatTime(event.end?.dateTime) }}
						</template>
						<template v-else>
							All day
						</template>
					</div>
					<div class="cal-event-info">
						<div class="cal-event-title">
							{{ event.summary || '(No title)' }}
							<span v-if="isNow(event)" class="cal-badge now">Now</span>
							<span v-else-if="isNext(event)" class="cal-badge next">Up Next</span>
						</div>
						<div v-if="event.location" class="cal-event-location">{{ event.location }}</div>
						<div v-if="event.attendees?.length" class="cal-event-attendees">
							{{ event.attendees.length }} attendee{{ event.attendees.length > 1 ? 's' : '' }}
						</div>
					</div>
					<a
						v-if="event.hangoutLink"
						:href="event.hangoutLink"
						target="_blank"
						rel="noopener"
						class="cal-btn small"
					>Join</a>
				</div>
			</div>
		</template>
	</div>
</template>

<style scoped>
.cal-app {
	flex: 1;
	display: flex;
	flex-direction: column;
	overflow: hidden;
	color: #000;
	font-size: 11px;
	background: #fff;
}

/* Auth */
.cal-auth {
	flex: 1;
	display: flex;
	align-items: center;
	justify-content: center;
	background: #c0c0c0;
}
.cal-auth-inner { text-align: center; }
.cal-auth-icon { font-size: 40px; display: block; margin-bottom: 8px; }
.cal-auth-inner h3 { color: #000; margin: 0 0 6px; font-size: 13px; }
.cal-auth-inner p { color: #444; margin: 0 0 12px; }

/* Toolbar */
.cal-toolbar {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 3px 4px;
	background: #c0c0c0;
	border-bottom: 1px solid #808080;
}
.cal-title { margin: 0; font-size: 12px; font-weight: bold; color: #000; }

/* Win98 buttons */
.cal-btn {
	padding: 3px 12px;
	background: #c0c0c0;
	border: 2px solid;
	border-color: #dfdfdf #808080 #808080 #dfdfdf;
	color: #000;
	font-size: 11px;
	font-family: inherit;
	cursor: pointer;
	text-decoration: none;
}
.cal-btn:active { border-color: #808080 #dfdfdf #dfdfdf #808080; }
.cal-btn.primary { font-weight: bold; }
.cal-btn.small { padding: 2px 8px; font-size: 10px; }

/* Error / loading / empty */
.cal-error {
	padding: 4px 8px;
	background: #ffe0e0;
	color: #c00;
	font-size: 11px;
}
.cal-loading, .cal-empty {
	padding: 32px 16px;
	text-align: center;
	color: #808080;
}

/* Events list */
.cal-events {
	flex: 1;
	overflow-y: auto;
	padding: 4px 0;
}
.cal-event {
	display: flex;
	align-items: flex-start;
	gap: 12px;
	padding: 6px 8px;
	border-left: 3px solid transparent;
	border-bottom: 1px solid #e0e0e0;
}
.cal-event:hover { background: #000080; color: #fff; }
.cal-event:hover .cal-event-time,
.cal-event:hover .cal-event-title,
.cal-event:hover .cal-event-location,
.cal-event:hover .cal-event-attendees { color: #fff; }
.cal-event.now {
	background: #ffffcc;
	border-left-color: #000080;
}
.cal-event.next {
	border-left-color: #808000;
}

.cal-event-time {
	width: 110px;
	flex-shrink: 0;
	font-size: 11px;
	color: #444;
	padding-top: 1px;
}
.cal-event-dash { margin: 0 2px; }

.cal-event-info { flex: 1; min-width: 0; }
.cal-event-title {
	font-size: 11px;
	font-weight: bold;
	color: #000;
	display: flex;
	align-items: center;
	gap: 6px;
}
.cal-event-location, .cal-event-attendees {
	font-size: 11px;
	color: #444;
	margin-top: 1px;
}

.cal-badge {
	font-size: 9px;
	font-weight: bold;
	text-transform: uppercase;
	padding: 1px 4px;
	letter-spacing: 0.3px;
	border: 1px solid;
}
.cal-badge.now { background: #ffffcc; color: #000080; border-color: #000080; }
.cal-badge.next { background: #fff; color: #808000; border-color: #808000; }
</style>
