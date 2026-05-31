// src/stores/accountsStore.js — multi-account credential store with legacy migration
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useGridStore } from '@/stores/gridStore'

const STORAGE_KEY = 'qs_saved_accounts'
const LEGACY_PREFIX = 'qs_autologin_'

export const useAccountsStore = defineStore('accounts', () => {
	const gridStore = useGridStore()

	function _load() {
		try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') }
		catch { return [] }
	}

	function _save(list) {
		try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)) } catch {}
	}

	function _matchKey(a, username, gridNick) {
		return a.username.toLowerCase() === username.toLowerCase() && a.gridNick === gridNick
	}

	// One-time migration from legacy per-grid credential keys
	if (localStorage.getItem(STORAGE_KEY) === null) {
		const imported = []
		const oldKeys = []
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i)
			if (!key?.startsWith(LEGACY_PREFIX)) continue
			oldKeys.push(key)
			try {
				const { username, password } = JSON.parse(localStorage.getItem(key))
				if (username) imported.push({ username, gridNick: key.slice(LEGACY_PREFIX.length), password: password ?? '', lastUsed: 0 })
			} catch {}
		}
		_save(imported)
		oldKeys.forEach(k => localStorage.removeItem(k))
	}

	const _raw = ref(_load())

	const accounts = computed(() => {
		const validNicks = new Set(gridStore.grids.map(g => g.nick))
		return _raw.value
			.filter(a => validNicks.has(a.gridNick))
			.sort((a, b) => b.lastUsed - a.lastUsed)
	})

	function addOrUpdate(username, gridNick, password) {
		const list = _load()
		const idx = list.findIndex(a => _matchKey(a, username, gridNick))
		const entry = { username, gridNick, password, lastUsed: Date.now() }
		if (idx >= 0) list[idx] = entry
		else list.push(entry)
		_save(list)
		_raw.value = list
	}

	function remove(username, gridNick) {
		const list = _load().filter(a => !_matchKey(a, username, gridNick))
		_save(list)
		_raw.value = list
	}

	function getPassword(username, gridNick) {
		return _load().find(a => _matchKey(a, username, gridNick))?.password ?? null
	}

	return { accounts, addOrUpdate, remove, getPassword }
})
