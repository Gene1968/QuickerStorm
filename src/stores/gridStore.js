// src/stores/gridStore.js — built-in + user-added grid registry; login state
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import builtinGrids from '@/config/grids.json'

const USER_GRIDS_KEY = 'qs_user_grids'

function loadUserGrids() {
	try {
		const raw = localStorage.getItem(USER_GRIDS_KEY)
		return raw ? JSON.parse(raw) : {}
	} catch { return {} }
}

function saveUserGrids(grids) {
	try { localStorage.setItem(USER_GRIDS_KEY, JSON.stringify(grids)) } catch {}
}

export const useGridStore = defineStore('grid', () => {
	// Merge built-in + user grids; user grids can override built-in by nick
	const userGrids = ref(loadUserGrids())

	const grids = computed(() => {
		const all = { ...builtinGrids, ...userGrids.value }
		// Sort: SL system grids first, then alphabetically by name
		return Object.values(all).sort((a, b) => {
			if (a.system && !b.system) return -1
			if (!a.system && b.system) return 1
			return a.name.localeCompare(b.name)
		})
	})

	// Default to OSGrid
	const selectedNick = ref('osgrid')

	const selectedGrid = computed(() =>
		grids.value.find(g => g.nick === selectedNick.value) ?? null
	)

	// login state: 'idle' | 'loading' | 'connected' | 'error'
	const loginState = ref('idle')
	const loginError = ref('')

	function selectGrid(nick) {
		selectedNick.value = nick
		loginState.value = 'idle'
		loginError.value = ''
	}

	function setLoginState(state, error = '') {
		loginState.value = state
		loginError.value = error
	}

	// ── User-managed grids ───────────────────────────────────────────────────

	/** Add or replace a user grid. nick must be non-empty. */
	function addUserGrid(grid) {
		if (!grid.nick || !grid.loginURI) return
		const normalized = {
			...grid,
			nick:      grid.nick.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-'),
			userAdded: true,
		}
		userGrids.value = { ...userGrids.value, [normalized.nick]: normalized }
		saveUserGrids(userGrids.value)
		selectedNick.value = normalized.nick
	}

	/** Remove a user-added grid. Cannot remove built-in grids. */
	function removeUserGrid(nick) {
		if (!userGrids.value[nick]) return
		const next = { ...userGrids.value }
		delete next[nick]
		userGrids.value = next
		saveUserGrids(next)
		// If we just removed the selected grid, fall back to osgrid
		if (selectedNick.value === nick) selectedNick.value = 'osgrid'
	}

	/** True if nick belongs to a user-added grid */
	function isUserGrid(nick) {
		return Boolean(userGrids.value[nick])
	}

	return {
		grids,
		selectedNick,
		selectedGrid,
		loginState,
		loginError,
		selectGrid,
		setLoginState,
		addUserGrid,
		removeUserGrid,
		isUserGrid,
	}
})
