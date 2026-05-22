/**
 * useAnnouncements — polls the SP Announcements list every 15 s.
 *
 * SP list columns required (create manually):
 *   Title (text)     — announcement message
 *   RoomId (text)    — room id where meeting is
 *   RoomName (text)  — display name of room
 *   SentBy (text)    — sender display name
 *   ExpiresAt (DateTime) — auto-expire (30 min after send)
 *
 * localStorage keys:
 *   ava_seen_ann   — JSON array of seen item IDs
 *   ava_snooze_ann — JSON {id: expiry_timestamp}
 */
import { ref, onUnmounted } from 'vue'
import { AnnouncementsRepo } from '@/api/backend.js'

// ── Module-level state ────────────────────────────────────────────────────────

/** The currently visible announcement: { id, message, roomId, roomName, sentBy, sentAt } */
export const activeAnnouncement = ref(null)

let pollTimer = null
let isStarted = false
let _unsubscribeRealtime = null

// ── localStorage helpers ──────────────────────────────────────────────────────

function getSeenIds() {
	try { return JSON.parse(localStorage.getItem('ava_seen_ann') || '[]') } catch { return [] }
}

function addSeenId(id) {
	try {
		const ids = getSeenIds()
		if (!ids.includes(id)) ids.push(id)
		localStorage.setItem('ava_seen_ann', JSON.stringify(ids))
	} catch { /* ignore */ }
}

function getSnoozed() {
	try { return JSON.parse(localStorage.getItem('ava_snooze_ann') || '{}') } catch { return {} }
}

function setSnoozed(map) {
	try { localStorage.setItem('ava_snooze_ann', JSON.stringify(map)) } catch { /* ignore */ }
}

function isSnoozed(id) {
	const map = getSnoozed()
	const now = Date.now()
	// Clear expired snooze entries
	let changed = false
	for (const k of Object.keys(map)) {
		if (map[k] < now) { delete map[k]; changed = true }
	}
	if (changed) setSnoozed(map)
	return !!map[id]
}

// ── Poll ──────────────────────────────────────────────────────────────────────

async function poll() {
	try {
		const items = await AnnouncementsRepo.listActive()
		const seenIds = getSeenIds()
		for (const item of items) {
			const id = String(item.Id)
			if (seenIds.includes(id)) continue
			if (isSnoozed(id)) continue
			// Already showing this one — don't reassign (would re-trigger the bell)
			if (activeAnnouncement.value?.id === id) break
			// Found a new unseen, un-snoozed announcement — show it
			activeAnnouncement.value = {
				id,
				message:  item.Title,
				roomId:   item.RoomId,
				roomName: item.RoomName,
				sentBy:   item.SentBy,
				sentAt:   item.Created || null,
			}
			window.dispatchEvent(new CustomEvent('ava-announcement', { detail: activeAnnouncement.value }))
			break
		}
	} catch {
		// Silently fail — list may not exist yet or network unavailable
	}
}

// ── Exported actions ──────────────────────────────────────────────────────────

/**
 * Write a new announcement row to SharePoint.
 * The item expires 30 minutes from now.
 */
export async function sendAnnouncement({ roomId, roomName, sentBy, message }) {
	const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString()
	await AnnouncementsRepo.create({ message, roomId, roomName, sentBy, expiresAt })
}

/** Permanently dismiss an announcement for this client. */
export function dismissAnnouncement(id) {
	addSeenId(id)
	if (activeAnnouncement.value?.id === id) activeAnnouncement.value = null
}

/** Snooze an announcement — re-shows after `minutes` minutes. */
export function snoozeAnnouncement(id, minutes = 5) {
	const map = getSnoozed()
	map[id] = Date.now() + minutes * 60 * 1000
	setSnoozed(map)
	if (activeAnnouncement.value?.id === id) activeAnnouncement.value = null
}

// ── Composable ────────────────────────────────────────────────────────────────

export function useAnnouncements() {
	function start() {
		if (isStarted) return
		isStarted = true
		poll()
		pollTimer = setInterval(poll, 15_000)
		if (typeof AnnouncementsRepo.subscribe === 'function') {
			_unsubscribeRealtime = AnnouncementsRepo.subscribe(() => poll())
		}
	}

	function stop() {
		clearInterval(pollTimer)
		pollTimer = null
		if (_unsubscribeRealtime) { try { _unsubscribeRealtime() } catch { /* ignore */ } _unsubscribeRealtime = null }
		isStarted = false
	}

	onUnmounted(stop)
	return { start, stop, sendAnnouncement, dismissAnnouncement, snoozeAnnouncement, activeAnnouncement }
}
