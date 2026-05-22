const OFFICE_RE = /^office-\d+$/

function otherUserInOffice (officeId, myUserId, users) {
	if (!officeId || !OFFICE_RE.test(officeId)) return false
	const me = myUserId != null ? String(myUserId) : ''
	return (users || []).some(
		(u) =>
			u &&
			u.status !== 'offline' &&
			u.roomId === officeId &&
			String(u.id) !== me,
	)
}

/**
 * Choose an office for "My Office" — prefer `preferredOfficeId` when no other online
 * user is already in that room; otherwise the first office in `officesList` with no
 * other occupant. Falls back to `preferredOfficeId` if every office appears taken
 * (degraded: user may arrive as visitor).
 *
 * @param {{ id: string }[]} officesList  e.g. `OFFICES` from officeLayout
 * @param {string|null} preferredOfficeId
 * @param {unknown} myUserId
 * @param {Array<{ id: unknown, roomId?: string, status?: string }>} users  presence rows
 * @returns {string|null}
 */
export function pickMyOfficeDestination (
	officesList,
	preferredOfficeId,
	myUserId,
	users,
) {
	if (!officesList?.length) return null
	const pref =
		preferredOfficeId && OFFICE_RE.test(preferredOfficeId)
			? preferredOfficeId
			: null
	if (pref && !otherUserInOffice(pref, myUserId, users)) return pref
	for (const o of officesList) {
		if (o?.id && !otherUserInOffice(o.id, myUserId, users)) return o.id
	}
	// Everyone appears in-room at once (stale poll) — still navigate somewhere
	return pref ?? officesList[0]?.id ?? null
}
