// src/composables/useNotifications.js — generic helpers over notificationStore.
// Friend-offer specific notifications live in useSocial (which owns respond/add), to avoid a
// circular dependency. This composable only offers reusable info/error notifications + store access.
import { useNotificationStore } from '@/stores/notificationStore'

export function useNotifications() {
	const store = useNotificationStore()

	function notifyInfo(title, body = '') {
		return store.notify({ tab: 'system', title, body, sticky: false })
	}
	function notifyError(title, body = '') {
		return store.notify({ tab: 'system', title, body, sticky: false, icon: 'error' })
	}

	return { store, notifyInfo, notifyError }
}
