// src/composables/useInventoryClipboard.js — inventory clipboard (Ctrl+X / Ctrl+C / Ctrl+V).
// Firestorm semantics (ref: ../phoenix-firestorm indra/newview/llinventorybridge.cpp + LLClipboard):
//   CUT  → mark ids 'cut';  PASTE = MOVE them into the target folder, then clear the clipboard.
//   COPY → mark ids 'copied'; PASTE = DUPLICATE each copyable item into the target (CopyInventoryItem,
//          each gets a fresh ItemID). The clipboard is KEPT after a copy-paste (FS pastes repeatedly).
// State is a single module-level ref so every inventory floater shares one clipboard (like the OS one).
import { ref, computed } from 'vue'

// { mode: 'cut'|'copy'|null, ids: string[], sourceFolderId: string|null }
const clipboard = ref({ mode: null, ids: [], sourceFolderId: null })

/** Pure reducer used by the composable + tests. Never mutates its input. */
export function clipboardReducer(state, action) {
	switch (action.type) {
		case 'setCut':
			if (!action.ids?.length) return state
			return { mode: 'cut', ids: [...action.ids], sourceFolderId: action.sourceFolderId ?? null }
		case 'setCopy':
			if (!action.ids?.length) return state
			return { mode: 'copy', ids: [...action.ids], sourceFolderId: action.sourceFolderId ?? null }
		case 'clear':
			return { mode: null, ids: [], sourceFolderId: null }
		default:
			return state
	}
}

/** True when an id is currently on the clipboard (used to dim CUT rows). */
export function isClipped(state, id) {
	return !!state && state.ids.includes(id)
}

export function useInventoryClipboard() {
	function setCut(ids, sourceFolderId = null) {
		clipboard.value = clipboardReducer(clipboard.value, { type: 'setCut', ids, sourceFolderId })
	}
	function setCopy(ids, sourceFolderId = null) {
		clipboard.value = clipboardReducer(clipboard.value, { type: 'setCopy', ids, sourceFolderId })
	}
	function clear() {
		clipboard.value = clipboardReducer(clipboard.value, { type: 'clear' })
	}

	const isEmpty = computed(() => clipboard.value.ids.length === 0)
	const mode    = computed(() => clipboard.value.mode)

	return { clipboard, setCut, setCopy, clear, isEmpty, mode, isClipped: (id) => isClipped(clipboard.value, id) }
}
