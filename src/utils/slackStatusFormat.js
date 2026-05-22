/**
 * Slack returns status_emoji / status_text and combined SharePoint SlackStatus
 * using :shortcode: tokens (e.g. :test_tube:). Convert those to Unicode for UI.
 */
import { emojify } from 'node-emoji'

// Unicode emoji that Slack uses but node-emoji doesn't know
const EXTRA = {
	technologist:           '🧑‍💻',
	face_with_rolling_eyes: '🙄',
	weight_lifting:         '🏋️',
	yoga:                   '🧘',
	billed_cap:             '🧢',
}

/** Slack / UI may use spaces inside names; gemoji + node-emoji expect underscores. */
const SHORTCODE_SPACED =
	/:((?:[a-zA-Z0-9_+-]+)(?:\s+[a-zA-Z0-9_+-]+)*):/g
const SHORTCODE = /:([a-z0-9_+-]+):/gi

function normalizeSlackShortcodes(str) {
	return str.replace(SHORTCODE_SPACED, (_, inner) => {
		const slug = inner.replace(/\s+/g, '_').toLowerCase()
		return `:${slug}:`
	})
}

function resolveEmoji(str) {
	let s = normalizeSlackShortcodes(str)
	// 1. Pre-substitute known gaps (keys are lowercase slugs)
	s = s.replace(SHORTCODE, (match, name) => EXTRA[name.toLowerCase()] ?? match)
	// 2. Convert remaining known shortcodes; strip truly unknown ones (custom workspace emoji)
	s = emojify(s, { fallback: '' })
	return s.trim()
}

export function slackStatusForDisplay(combined) {
	if (!combined || typeof combined !== 'string') return ''
	return resolveEmoji(combined)
}

/** Raw Slack users.list member object */
export function slackStatusFromProfile(member) {
	const emoji = member?.profile?.status_emoji || ''
	const text  = member?.profile?.status_text  || ''
	if (!emoji && !text) return ''
	const combined = emoji ? `${emoji} ${text}`.trim() : text
	return resolveEmoji(combined)
}

/** Normalize user input to Slack `:shortcode:` form */
export function normalizeSlackEmojiInput(raw) {
	const s = (raw || '').trim()
	if (!s) return ''
	if (s.startsWith(':')) return s
	return `:${s.replace(/^:+|:+$/g, '')}:`
}
