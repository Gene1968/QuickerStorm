// src/composables/useTeleportHistory.js — persisted log of teleport destinations.
// WHY: history must be recorded at the single TP source of truth (useTeleport), but the Places
// floater (usePlaces) also needs to read/clear it. usePlaces already imports useTeleport, so
// recording from useTeleport via usePlaces would be circular. This standalone module breaks the
// cycle: both useTeleport (writer) and usePlaces (reader) import it. Module-level ref = shared.
import { ref } from 'vue'
import { useSessionStore } from '@/stores/sessionStore'

const HIST_KEY = (agentId) => `qs_places_hist_${agentId || 'anon'}`
const HIST_MAX = 50

const history  = ref([])  // [{ name, regionName, x, y, z, ts }] — most-recent first
let loadedFor  = null     // agentId the current history.value was loaded for

function load(agentId) {
	try {
		const raw = localStorage.getItem(HIST_KEY(agentId))
		history.value = raw ? JSON.parse(raw) : []
	} catch { history.value = [] }
	loadedFor = agentId
}

function persist(agentId) {
	try { localStorage.setItem(HIST_KEY(agentId), JSON.stringify(history.value)) } catch {}
}

export function useTeleportHistory() {
	const session = useSessionStore()
	// WHY: reload on first use and whenever the logged-in agent changes (avatar switch must not
	// bleed another user's history into this session).
	if (loadedFor !== session.agentId) load(session.agentId)

	// WHY: dedup against the most-recent entry — re-TPing the same spot just refreshes its
	// timestamp instead of spamming the list. Coordinates rounded so sub-metre jitter still dedups.
	function record(place) {
		if (loadedFor !== session.agentId) load(session.agentId)
		const entry = {
			name: place.name || place.regionName || 'Unknown',
			regionName: place.regionName || session.regionName || '',
			x: place.x, y: place.y, z: place.z,
			ts: Date.now(),
		}
		const top = history.value[0]
		if (top && top.name === entry.name
			&& Math.round(top.x) === Math.round(entry.x)
			&& Math.round(top.y) === Math.round(entry.y)) {
			top.ts = entry.ts
			history.value = [...history.value]  // trigger reactivity
		} else {
			history.value.unshift(entry)
			if (history.value.length > HIST_MAX) history.value.length = HIST_MAX
		}
		persist(session.agentId)
	}

	function clear() {
		history.value = []
		persist(session.agentId)
	}

	return { history, record, clear }
}
