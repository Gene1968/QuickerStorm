/**
 * useTheme — dark / light mode toggle.
 * Applies a `light` class to <html> and persists the choice in localStorage.
 * Dispatches `ava-theme` so the Three.js engine can update its background.
 */
import { ref } from 'vue'

const LS_KEY = 'darkmode'

// Module-level so state is shared across all callers
// WHY: default dark until user explicitly chooses; null key = first visit = dark
const stored = localStorage.getItem(LS_KEY)
const isDark = ref(stored === null ? true : stored === 'dark')

function applyClass() {
	document.documentElement.classList.toggle('light', !isDark.value)
}

// Apply immediately on first import (before Vue mounts)
applyClass()

export function useTheme() {
	function toggle() {
		isDark.value = !isDark.value
		localStorage.setItem(LS_KEY, isDark.value ? 'dark' : 'light')
		applyClass()
		window.dispatchEvent(new CustomEvent('ava-theme', { detail: { dark: isDark.value } }))
	}

	function setDark(value) {
		if (isDark.value === value) return
		isDark.value = value
		localStorage.setItem(LS_KEY, value ? 'dark' : 'light')
		applyClass()
		window.dispatchEvent(new CustomEvent('ava-theme', { detail: { dark: isDark.value } }))
	}

	return { isDark, toggle, setDark }
}
