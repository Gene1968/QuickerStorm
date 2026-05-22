import { OFFICES } from '@/config/officeLayout.js'

const OFFICE_ROOM_RE = /^office-\d+$/

function comparePresenceUserId (a, b) {
	const na = Number(a)
	const nb = Number(b)
	const aNum = Number.isFinite(na) && String(na) === String(a)
	const bNum = Number.isFinite(nb) && String(nb) === String(b)
	if (aNum && bNum) return na - nb
	if (aNum && !bNum) return -1
	if (!aNum && bNum) return 1
	return String(a).localeCompare(String(b))
}

/**
 * True if this user should give up the office desk for this poll (same rules as
 * {@link stripDuplicateOfficeDeskOccupants}).
 */
export function shouldYieldDuplicateOfficeDesk (myUserId, users) {
	if (myUserId == null || !users?.length) return false
	return stripDuplicateOfficeDeskOccupants(users).has(String(myUserId))
}

/**
 * Office desks are single-seat. After a reload, stale presence can leave two users
 * with the same `roomId` + `office-N:desk`. Returns ids who should render **without**
 * the desk seat (standing from pose / clearRoomPos) so avatars do not overlap.
 *
 * Winner: the user whose id matches that office's door assignment in `OFFICES`
 * (same rule as the door label slot for that room). If none of the conflicters match,
 * the lowest id wins (stable tie-break).
 *
 * @param {Array<{ id: unknown, roomId?: string, seatId?: string|null, status?: string }>} users
 * @returns {Set<string>}
 */
export function stripDuplicateOfficeDeskOccupants (users) {
	const strip = new Set()
	if (!users?.length) return strip

	const byRoom = new Map()
	for (const u of users) {
		if (!u || u.status === 'offline') continue
		const roomId = u.roomId
		if (!roomId || !OFFICE_ROOM_RE.test(roomId)) continue
		const desk = `${roomId}:desk`
		if (u.seatId !== desk) continue
		if (!byRoom.has(roomId)) byRoom.set(roomId, [])
		byRoom.get(roomId).push(u)
	}

	for (const [, list] of byRoom) {
		if (list.length <= 1) continue
		const roomId = list[0].roomId
		const doorAssignee = OFFICES.find((o) => o.id === roomId)?.userId
		const assigneeInRoom = list.filter(
			(u) => doorAssignee != null && String(u.id) === String(doorAssignee),
		)
		let winner
		if (assigneeInRoom.length >= 1) {
			winner = [...assigneeInRoom].sort((a, b) =>
				comparePresenceUserId(a.id, b.id),
			)[0]
		} else {
			winner = [...list].sort((a, b) =>
				comparePresenceUserId(a.id, b.id),
			)[0]
		}
		for (const u of list) {
			if (String(u.id) !== String(winner.id)) strip.add(String(u.id))
		}
	}
	return strip
}
