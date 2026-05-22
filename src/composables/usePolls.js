/**
 * usePolls — Real-time room-scoped polls.
 *
 * Singleton reactive cache keyed by pollId. Subscribes to:
 *   pr  — single-poll state update (upsert into cache)
 *   prd — poll deleted (remove from cache)
 *   pl  — list response (replace all polls for a room)
 *
 * Public actions: createPoll, vote, closePoll, deletePoll, updatePollEndsAt,
 * loadForRoom, myVote.
 */

import { ref, computed } from 'vue'
import { useRealtimeSocket } from '@/composables/useRealtimeSocket.js'
import { useAvatarStore } from '@/stores/avatarStore.js'

const polls = ref([])  // flat list, each poll has .roomId
let started = false

function ensureStarted() {
	if (started) return
	started = true

	const { on } = useRealtimeSocket()

	on('pr', (data) => {
		const p = data?.poll
		if (!p || !p.id) return
		const idx = polls.value.findIndex(x => x.id === p.id)
		if (idx === -1) polls.value.push(p)
		else polls.value.splice(idx, 1, p)
	})

	on('prd', (data) => {
		const id = data?.pollId
		if (!id) return
		const idx = polls.value.findIndex(x => x.id === id)
		if (idx !== -1) polls.value.splice(idx, 1)
	})

	on('pl', (data) => {
		const list = Array.isArray(data?.polls) ? data.polls : []
		const roomId = data?.roomId
		if (!roomId) return
		const others = polls.value.filter(p => p.roomId !== roomId)
		polls.value = [...others, ...list]
	})
}

export function usePolls() {
	ensureStarted()
	const { emit } = useRealtimeSocket()
	const avatarStore = useAvatarStore()

	function pollsForRoom(roomId) {
		return computed(() => polls.value
			.filter(p => p.roomId === roomId)
			.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')))
	}

	function getPollById(pollId) {
		return computed(() => polls.value.find(p => p.id === pollId) || null)
	}

	function loadForRoom(roomId) {
		if (!roomId) return
		emit('pl', { roomId })
	}

	function createPoll(question, options, roomId, endsAt = null) {
		const trimmed = (question || '').trim()
		const opts = (options || []).map(o => String(o).trim()).filter(Boolean)
		if (!trimmed || opts.length < 2) return false
		emit('pc', { question: trimmed, options: opts, roomId, endsAt })
		return true
	}

	function vote(pollId, optionIdx) {
		emit('pv', { pollId, optionIdx })
	}

	function closePoll(pollId) {
		emit('px', { pollId })
	}

	function updatePollEndsAt(pollId, endsAt) {
		// Pass null to clear; ISO string to set.
		emit('pu', { pollId, endsAt })
	}

	function deletePoll(pollId) {
		emit('pd', { pollId })
	}

	function myVote(poll) {
		if (!poll || !Array.isArray(poll.votes)) return null
		const myId = avatarStore.authUserId
		if (!myId) return null
		const found = poll.votes.find(v => v[0] === myId)
		return found ? found[1] : null
	}

	return {
		polls,
		pollsForRoom,
		getPollById,
		loadForRoom,
		createPoll,
		vote,
		closePoll,
		updatePollEndsAt,
		deletePoll,
		myVote,
	}
}
