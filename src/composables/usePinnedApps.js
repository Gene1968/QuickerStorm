/**
 * Shared reactive pinned-app names (localStorage key ava_pinned_apps).
 * AppGrid and OfficeShelf use the same ref so pin/unpin updates the shelf immediately.
 *
 * unpinnedDefaults tracks default apps the user has explicitly hidden.
 * A default app is shown in My Apps unless its name is in unpinnedDefaults.
 */
import { ref } from 'vue'

export const LS_KEY_PINNED_APPS      = 'ava_pinned_apps'
export const LS_KEY_UNPINNED_DEFAULTS = 'ava_unpinned_defaults'

function readSet(key) {
	try {
		return new Set(JSON.parse(localStorage.getItem(key) || '[]'))
	} catch {
		return new Set()
	}
}

const pinnedNames      = ref(readSet(LS_KEY_PINNED_APPS))
const unpinnedDefaults = ref(readSet(LS_KEY_UNPINNED_DEFAULTS))

function persistToStorage() {
	localStorage.setItem(LS_KEY_PINNED_APPS,       JSON.stringify([...pinnedNames.value]))
	localStorage.setItem(LS_KEY_UNPINNED_DEFAULTS, JSON.stringify([...unpinnedDefaults.value]))
}

/** Sync refs from localStorage (e.g. after presence restores prefs or another tab writes). */
export function syncPinnedAppsFromStorage() {
	pinnedNames.value      = readSet(LS_KEY_PINNED_APPS)
	unpinnedDefaults.value = readSet(LS_KEY_UNPINNED_DEFAULTS)
}

if (typeof window !== 'undefined') {
	window.addEventListener('storage', e => {
		if (e.key === LS_KEY_PINNED_APPS || e.key === LS_KEY_UNPINNED_DEFAULTS || e.key === null)
			syncPinnedAppsFromStorage()
	})
}

export function usePinnedApps() {
	function isPinned(app) {
		return pinnedNames.value.has(app.AppName)
	}

	/** True when a default app has been explicitly hidden by the user. */
	function isUnpinnedDefault(app) {
		return !!app.IsDefault && unpinnedDefaults.value.has(app.AppName)
	}

	/** Toggle a non-default app in/out of My Apps. */
	function togglePin(app) {
		const next = new Set(pinnedNames.value)
		if (next.has(app.AppName)) next.delete(app.AppName)
		else next.add(app.AppName)
		pinnedNames.value = next
		persistToStorage()
	}

	/** Remove a non-default app from My Apps. */
	function unpin(app) {
		const next = new Set(pinnedNames.value)
		next.delete(app.AppName)
		pinnedNames.value = next
		persistToStorage()
	}

	/** Hide a default app from My Apps (moves it to More Apps). */
	function hideDefault(app) {
		const next = new Set(unpinnedDefaults.value)
		next.add(app.AppName)
		unpinnedDefaults.value = next
		persistToStorage()
	}

	/** Restore a default app back to My Apps. */
	function restoreDefault(app) {
		const next = new Set(unpinnedDefaults.value)
		next.delete(app.AppName)
		unpinnedDefaults.value = next
		persistToStorage()
	}

	return {
		pinnedNames,
		unpinnedDefaults,
		isPinned,
		isUnpinnedDefault,
		togglePin,
		unpin,
		hideDefault,
		restoreDefault,
		syncFromStorage: syncPinnedAppsFromStorage,
	}
}
