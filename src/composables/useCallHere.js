/**
 * useCallHere — peer-to-peer "join me" invite system.
 *
 * Mechanism (Option A — SP users list):
 *  • Sender writes PendingInvite JSON to the target user's SP users-list row.
 *  • Recipient's presence poll (every 8 s) reads PendingInvite from their own row
 *    and populates myPendingInvite (usePresence.js).
 *  • CallInviteBanner.vue watches activeInvite and shows Join / Snooze / Dismiss.
 *  • Accept or dismiss clears PendingInvite from the recipient's own SP row.
 *
 * Option B note: in a real-time relay world, replace the listApi.updateListItem
 * calls in sendCallHere / dismissInvite with a targeted WebSocket/Supabase send.
 * myPendingInvite would be set by the relay message handler instead of the SP poll.
 */
import { ref, computed, watch } from 'vue'
import { PresenceRepo } from '@/api/backend.js'
import { myPendingInvite } from '@/composables/usePresence.js'
import { usePresenceStore } from '@/stores/presenceStore.js'
import { useOfficeStore } from '@/stores/officeStore.js'
import { useAvatarStore } from '@/stores/avatarStore.js'

export function useCallHere() {
	const presenceStore = usePresenceStore()
	const officeStore   = useOfficeStore()
	const avatarStore   = useAvatarStore()

	// ── Sender state ─────────────────────────────────────────────────
	const sending = ref(false)
	const sent    = ref(false)

	async function sendCallHere(targetUser) {
		if (sending.value || !targetUser?.id) return
		sending.value = true
		sent.value    = false
		try {
			const invite = {
				fromUserId:   presenceStore.myUserId,
				fromName:     avatarStore.displayName || 'Someone',
				fromRoomId:   officeStore.currentRoomId,
				fromRoomName: officeStore.currentRoom?.name || officeStore.currentRoomId,
				sentAt:       new Date().toISOString(),
			}
			await PresenceRepo.writeInvite(targetUser.id, JSON.stringify(invite))
			sent.value = true
			setTimeout(() => { sent.value = false }, 3000)
		} catch (err) {
			console.warn('[callHere] send failed:', err.message)
		} finally {
			sending.value = false
		}
	}

	// ── Recipient state ───────────────────────────────────────────────
	// Session-level snooze — resets on page reload (call invites are ephemeral).
	const snoozedUntil = ref(0)

	/** The invite to display — null if none, expired, snoozed, or recipient is busy. */
	const activeInvite = computed(() => {
		const inv = myPendingInvite.value
		if (!inv?.fromRoomId) return null
		// Auto-expire after 10 minutes
		if (new Date(inv.sentAt).getTime() < Date.now() - 10 * 60 * 1000) return null
		// Session snooze
		if (snoozedUntil.value > Date.now()) return null
		// Busy = DND for incoming Call-Here invites
		if (avatarStore.status === 'busy') return null
		return inv
	})

	// Auto-clear new invites that land while busy, and toast the user so the
	// silent decline isn't invisible to them. Sender's own indicator simply
	// reverts when their next poll sees the cleared row.
	watch(myPendingInvite, (inv, prev) => {
		if (!inv) return
		if (prev?.sentAt === inv.sentAt) return // dedupe re-poll of same row
		if (avatarStore.status !== 'busy') return
		const fromName = inv.fromName || 'Someone'
		window.dispatchEvent(new CustomEvent('ava-toast', {
			detail: { message: `🔕 Auto-declined Call-Here from ${fromName} (you're set to Busy)`, type: 'info' },
		}))
		dismissInvite()
	})

	function snoozeInvite() {
		snoozedUntil.value = Date.now() + 5 * 60 * 1000
	}

	async function dismissInvite() {
		myPendingInvite.value = null   // immediate local clear
		const myId = presenceStore.myUserId
		if (myId) {
			try { await PresenceRepo.clearInvite(myId) }
			catch (err) { console.warn('[callHere] dismiss failed:', err.message) }
		}
	}

	async function acceptInvite() {
		const inv = activeInvite.value
		if (!inv) return
		officeStore.navigateTo(inv.fromRoomId)
		await dismissInvite()
	}

	return {
		sendCallHere,
		sending,
		sent,
		activeInvite,
		acceptInvite,
		snoozeInvite,
		dismissInvite,
	}
}
