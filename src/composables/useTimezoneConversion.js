/**
 * Timezone conversion for availability/scheduling (no library).
 * Converts times between IANA timezones on a given date.
 */

/**
 * Offset in minutes: local - UTC (e.g. PST = -480).
 * @param {string} dateStr - "YYYY-MM-DD"
 * @param {string} timeZone - IANA e.g. "America/Los_Angeles"
 * @returns {number}
 */
export function getOffsetMinutesForDate(dateStr, timeZone) {
	const noonUtc = new Date(dateStr + 'T12:00:00.000Z');
	const f = new Intl.DateTimeFormat('en-US', {
		timeZone,
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
	});
	const parts = f.formatToParts(noonUtc);
	const hour = parseInt(parts.find((p) => p.type === 'hour').value, 10);
	const minute = parseInt(parts.find((p) => p.type === 'minute').value, 10);
	const localMinutes = hour * 60 + minute;
	return localMinutes - 12 * 60;
}

/**
 * Convert a time from one timezone to another on a given date.
 * @param {string} dateStr - "YYYY-MM-DD"
 * @param {string} timeStr - "HH:mm"
 * @param {string} fromTimeZone - IANA e.g. "America/Los_Angeles"
 * @param {string} toTimeZone - IANA e.g. "America/Chicago"
 * @returns {string} "HH:mm" in toTimeZone
 */
export function convertTime(dateStr, timeStr, fromTimeZone, toTimeZone) {
	const [hours, mins] = timeStr.split(':').map(Number);
	const localMinutesSinceMidnight = hours * 60 + mins;

	const offsetSource = getOffsetMinutesForDate(dateStr, fromTimeZone);
	const utcMinutesSinceMidnight = localMinutesSinceMidnight - offsetSource;

	const utcMidnight = new Date(dateStr + 'T00:00:00.000Z');
	const utcMs = utcMidnight.getTime() + utcMinutesSinceMidnight * 60 * 1000;
	const utcDate = new Date(utcMs);

	const formatter = new Intl.DateTimeFormat('en-US', {
		timeZone: toTimeZone,
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
	});
	return formatter.format(utcDate);
}

/**
 * Get the 3-letter timezone abbreviation for a given date and timezone (e.g. PST, CST, EDT).
 * @param {string} dateStr - "YYYY-MM-DD"
 * @param {string} timeZone - IANA e.g. "America/Los_Angeles"
 * @returns {string} e.g. "PST", "CST", "EDT"
 */
export function getTimezoneAbbreviation(dateStr, timeZone) {
	const date = new Date(dateStr + 'T12:00:00.000Z');
	const formatter = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' });
	const parts = formatter.formatToParts(date);
	const tzPart = parts.find((p) => p.type === 'timeZoneName');
	return tzPart ? tzPart.value : '';
}

/**
 * Whether the stored value looks like a full ISO date-time string (vs legacy "HH:mm").
 * @param {string} value - Stored StartTime or EndTime
 * @returns {boolean}
 */
export function isMeetingTimeISO(value) {
	if (value == null || typeof value !== 'string') return false;
	return value.includes('T') || value.length > 12;
}

/**
 * Build full ISO start/end from date + time strings in a given timezone.
 * @param {string} dateStr - "YYYY-MM-DD"
 * @param {string} startTimeStr - "HH:mm" or "HH:mm:ss"
 * @param {string} endTimeStr - "HH:mm" or "HH:mm:ss"
 * @param {string} timezone - IANA e.g. "America/Los_Angeles"
 * @returns {{ startISO: string, endISO: string }}
 */
export function toMeetingStartEndISO(dateStr, startTimeStr, endTimeStr, timezone) {
	if (!dateStr || !startTimeStr || !timezone) return { startISO: '', endISO: '' };
	const offsetMins = getOffsetMinutesForDate(dateStr, timezone);
	const utcMidnight = new Date(dateStr + 'T00:00:00.000Z').getTime();
	const [startH, startM] = startTimeStr.split(':').map(Number);
	const startLocalMins = (startH ?? 0) * 60 + (startM ?? 0);
	const startUtcMins = startLocalMins - offsetMins;
	const startMs = utcMidnight + startUtcMins * 60 * 1000;
	const startISOOut = new Date(startMs).toISOString();
	let endMs;
	if (endTimeStr) {
		const [endH, endM] = endTimeStr.split(':').map(Number);
		const endLocalMins = (endH ?? 0) * 60 + (endM ?? 0);
		const endUtcMins = endLocalMins - offsetMins;
		endMs = utcMidnight + endUtcMins * 60 * 1000;
	} else {
		endMs = startMs + 60 * 60 * 1000;
	}
	const endISOOut = new Date(endMs).toISOString();
	return { startISO: startISOOut, endISO: endISOOut };
}

/**
 * Format stored StartTime/EndTime for display (time-only). Supports both ISO and legacy "HH:mm".
 * @param {string} value - Stored StartTime or EndTime
 * @returns {string} "HH:mm"
 */
export function meetingTimeForDisplay(value) {
	if (value == null || typeof value !== 'string') return '';
	if (isMeetingTimeISO(value)) {
		const d = new Date(value);
		if (Number.isNaN(d.getTime())) return '';
		const h = d.getHours();
		const m = d.getMinutes();
		return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
	}
	const parts = value.trim().split(':');
	const h = (parts[0] ?? '0').padStart(2, '0');
	const m = (parts[1] ?? '0').padStart(2, '0');
	return `${h}:${m}`;
}

/**
 * Get "HH:mm" in a timezone from an ISO string (for slot overlap comparison).
 * @param {string} isoStr - Full ISO date-time
 * @param {string} timeZone - IANA e.g. "America/Los_Angeles"
 * @returns {string} "HH:mm"
 */
export function isoToTimeInTz(isoStr, timeZone) {
	if (!isoStr || typeof isoStr !== 'string') return '';
	if (!isMeetingTimeISO(isoStr)) return isoStr;
	const d = new Date(isoStr);
	if (Number.isNaN(d.getTime())) return '';
	const formatter = new Intl.DateTimeFormat('en-US', {
		timeZone: timeZone || undefined,
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
	});
	return formatter.format(d);
}
