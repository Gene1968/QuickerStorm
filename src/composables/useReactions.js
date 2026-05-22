/**
 * useReactions — Real-time room-scoped emoji reactions.
 *
 * Module-level singleton: subscribes to 'rx' WS events on first use,
 * exposes a reactive list of recent reactions and a sender helper.
 *
 * Reactions auto-expire from the list after REACTION_TTL_MS (matches the
 * bubble animation length so old reactions don't pile up in memory).
 */

import { ref } from 'vue'
import { useRealtimeSocket } from '@/composables/useRealtimeSocket.js'

// ── Allowed emoji set (must match server whitelist) ─────────────────────
export const REACTION_EMOJI = [
	'👍', '❤️', '🎉', '😂', '👏', '💡', '🔥', '✨', '🤔', '👀',
	'😮', '😢', '🙏', '✅', '❌', '🚀', '☕', '🎂', '🎵', '👋',
]

const REACTION_TTL_MS = 2500

// ── Singleton state ─────────────────────────────────────────────────────
const reactions = ref([])  // [{ id, fromUserId, emoji, ts }]
let started = false
let nextId = 1
const minLocalIntervalMs = 400
let lastLocalEmit = 0

function ensureStarted() {
	if (started) return
	started = true

	const { on } = useRealtimeSocket()

	on('rx', (data) => {
		if (!data?.emoji) return
		const id = nextId++
		reactions.value.push({
			id,
			fromUserId: data.fromUserId || null,
			emoji: data.emoji,
			ts: data.ts || Date.now(),
		})
		// Auto-prune
		setTimeout(() => {
			const idx = reactions.value.findIndex(r => r.id === id)
			if (idx !== -1) reactions.value.splice(idx, 1)
		}, REACTION_TTL_MS)
	})
}

export function useReactions() {
	ensureStarted()
	const { emit } = useRealtimeSocket()

	function sendReaction(emoji) {
		if (!REACTION_EMOJI.includes(emoji)) return false
		const now = Date.now()
		if (now - lastLocalEmit < minLocalIntervalMs) return false
		lastLocalEmit = now
		emit('rx', { emoji })
		return true
	}

	return {
		reactions,
		sendReaction,
		REACTION_EMOJI,
	}
}
