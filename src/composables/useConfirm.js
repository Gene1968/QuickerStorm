/**
 * useConfirm — promise-based confirm dialog replacement for window.confirm().
 *
 * Usage from non-Vue code (e.g. useOfficeEngine):
 *   import { avaConfirm } from '@/composables/useConfirm.js'
 *   const ok = await avaConfirm({ title: 'Leave?', message: 'You will be muted.' })
 *
 * The ConfirmModal.vue component (mounted in OfficeView) listens for the
 * 'ava-confirm' CustomEvent and renders the dialog.
 */
import { ref } from 'vue'

/** Reactive state read by ConfirmModal.vue */
export const confirmState = ref(null)  // { title, message, confirmLabel, cancelLabel, resolve }

/**
 * Show a styled confirm dialog. Returns a Promise<boolean>.
 * @param {{ title?: string, message: string, confirmLabel?: string, cancelLabel?: string }} opts
 */
export function avaConfirm(opts) {
	return new Promise(resolve => {
		confirmState.value = {
			title:        opts.title || 'Confirm',
			message:      opts.message,
			confirmLabel: opts.confirmLabel || 'OK',
			cancelLabel:  opts.cancelLabel  || 'Cancel',
			resolve,
		}
	})
}

/** Called by ConfirmModal when the user picks an option. */
export function resolveConfirm(result) {
	if (confirmState.value?.resolve) {
		confirmState.value.resolve(result)
	}
	confirmState.value = null
}
