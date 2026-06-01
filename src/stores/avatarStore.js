import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useIndexedDB } from '@/composables/useIndexedDB.js'

const AVATAR_KEY = 'ava_avatar_config'

const DEFAULT_COLORS = [
	'#00b4d8', '#2979ff', '#7c4dff', '#00c853',
	'#ff6d00', '#ff4081', '#00bcd4', '#f44336',
]

export const useAvatarStore = defineStore('avatar', () => {
	const db = useIndexedDB()

	// ── State ──────────────────────────────────────────────────────
	const avatarUrl   = ref(null)   // JSON avatar config or legacy .glb URL
	const color       = ref('#00b4d8')  // outfit / primary color
	const skinTone    = ref('#C68642')
	const hairColor   = ref('#3B2314')
	const hairStyle   = ref('medium')   // 'none' | 'short' | 'medium' | 'long'  ('smedium' migrated → 'medium' on load)
	const displayName = ref('')
	const title       = ref('')
	const initials    = ref('')
	const status      = ref('online')  // 'online' | 'away' | 'busy' | 'offline'
	const statusEmoji   = ref('')
	const statusMessage = ref('')
	const isSetupDone = ref(false)
	const bio = ref('')

	// ── Computed ───────────────────────────────────────────────────
	const avatarInitials = computed(() => {
		if (initials.value) return initials.value
		const parts = displayName.value.trim().split(' ')
		if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
		return displayName.value.slice(0, 2).toUpperCase() || 'AV'
	})

	const statusColor = computed(() => {
		const map = { online: '#00c853', away: '#ff6d00', busy: '#f44336', offline: '#4d6080' }
		return map[status.value] || map.offline
	})

	// ── Actions ────────────────────────────────────────────────────
	function _snapshot() {
		return {
			avatarUrl:    avatarUrl.value,
			color:        color.value,
			skinTone:     skinTone.value,
			hairColor:    hairColor.value,
			hairStyle:    hairStyle.value,
			displayName:  displayName.value,
			title:        title.value,
			initials:     initials.value,
			status:       status.value,
			statusEmoji:   statusEmoji.value,
			statusMessage: statusMessage.value,
			bio:           bio.value,
			isSetupDone:   isSetupDone.value,
		}
	}

	function _apply(saved) {
		avatarUrl.value    = saved.avatarUrl    ?? null
		color.value        = saved.color        ?? pickRandomColor()
		skinTone.value     = saved.skinTone     ?? '#C68642'
		hairColor.value    = saved.hairColor    ?? '#3B2314'
		const rawStyle     = saved.hairStyle ?? 'medium'
		hairStyle.value    = rawStyle === 'smedium' ? 'medium' : rawStyle
		displayName.value  = saved.displayName  ?? ''
		title.value        = saved.title        ?? ''
		initials.value     = saved.initials     ?? ''
		status.value       = saved.status       ?? 'online'
		statusEmoji.value   = saved.statusEmoji   ?? ''
		statusMessage.value = saved.statusMessage ?? ''
		bio.value           = saved.bio          ?? ''
		isSetupDone.value   = saved.isSetupDone  ?? false
	}

	async function load() {
		let lsSaved  = null
		let idbSaved = null

		// localStorage — synchronous, always attempted first (more reliable in SP)
		try {
			const raw = localStorage.getItem(AVATAR_KEY)
			if (raw) lsSaved = JSON.parse(raw)
		} catch { /* ignore */ }

		// IndexedDB — richer storage; may be blocked in some SP contexts
		try {
			idbSaved = await db.get(AVATAR_KEY)
		} catch { /* ignore */ }

		// localStorage is always written before IDB in save(), so it is always at least
		// as fresh as IDB (and may be fresher if a prior IDB write failed silently).
		// Prefer LS when it has a completed setup; fall back to IDB only when LS is
		// incomplete or missing (e.g. privacy settings blocked LS, IDB still worked).
		const saved = lsSaved?.isSetupDone
			? lsSaved
			: (idbSaved ?? lsSaved)
		if (saved) _apply(saved)
	}

	async function save() {
		const data = _snapshot()
		// Write to localStorage first — synchronous, more reliable in SP contexts
		try { localStorage.setItem(AVATAR_KEY, JSON.stringify(data)) } catch { /* ignore */ }
		// Also write to IDB
		try { await db.set(AVATAR_KEY, data) } catch { /* ignore */ }
	}

	async function completeSetup(payload) {
		avatarUrl.value   = payload.avatarUrl   ?? avatarUrl.value
		color.value       = payload.color       ?? color.value
		skinTone.value    = payload.skinTone    ?? skinTone.value
		hairColor.value   = payload.hairColor   ?? hairColor.value
		hairStyle.value   = payload.hairStyle   ?? hairStyle.value
		displayName.value = payload.displayName ?? displayName.value
		title.value       = payload.title       ?? title.value
		initials.value    = payload.initials    ?? ''
		isSetupDone.value = true
		await save()
	}

	async function setStatus(newStatus) {
		status.value = newStatus
		await save()
	}

	async function setAvatarUrl(url) {
		avatarUrl.value = url
		await save()
	}

	async function setBio(text) {
		bio.value = (text || '').trim()
		await save()
	}

	function pickRandomColor() {
		return DEFAULT_COLORS[Math.floor(Math.random() * DEFAULT_COLORS.length)]
	}

	return {
		avatarUrl,
		color,
		skinTone,
		hairColor,
		hairStyle,
		displayName,
		title,
		initials,
		bio,
		status,
		statusEmoji,
		statusMessage,
		isSetupDone,
		avatarInitials,
		statusColor,
		load,
		save,
		completeSetup,
		setStatus,
		setAvatarUrl,
		setBio,
	}
})
