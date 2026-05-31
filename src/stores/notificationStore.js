// src/stores/notificationStore.js — toast + persistent notification state.
// toasts[] render in ToastStack (right edge, auto-fade). items[] persist in NotificationsFloater,
// bucketed by tab. A "group" links a toast to its persistent item so actioning one clears both.
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const NOTIF_TABS = ['system', 'transactions', 'invitations', 'group']

export const useNotificationStore = defineStore('notifications', () => {
	const toasts = ref([]) // [{ id, groupId, kind, title, body, icon, actions, sticky, createdAt }]
	const items  = ref([]) // [{ id, groupId, tab, title, body, icon, actions, read, ts }]

	let _seq = 0
	const nextId = () => `n${++_seq}`

	function pushToast({ groupId = null, kind = 'info', title = '', body = '', icon = '', actions = [], sticky = false }) {
		const id = nextId()
		toasts.value = [{ id, groupId, kind, title, body, icon, actions, sticky, createdAt: Date.now() }, ...toasts.value]
		return id
	}
	function dismissToast(id) { toasts.value = toasts.value.filter(t => t.id !== id) }

	function addItem({ groupId = null, tab = 'system', title = '', body = '', icon = '', actions = [] }) {
		const id = nextId()
		items.value = [{ id, groupId, tab, title, body, icon, actions, read: false, ts: Date.now() }, ...items.value]
		return id
	}
	function removeItem(id) { items.value = items.value.filter(i => i.id !== id) }
	function markRead(id)   { items.value = items.value.map(i => i.id === id ? { ...i, read: true } : i) }
	function clearTab(tab)  { items.value = items.value.filter(i => i.tab !== tab) }

	/** Remove every toast + item sharing a groupId (used by offer Accept/Decline). */
	function dismissGroup(groupId) {
		if (!groupId) return
		toasts.value = toasts.value.filter(t => t.groupId !== groupId)
		items.value  = items.value.filter(i => i.groupId !== groupId)
	}

	/** Create a persistent item and (optionally) a linked toast. */
	function notify({ groupId = nextId(), tab = 'system', title = '', body = '', icon = '', actions = [], toast = true, sticky = false } = {}) {
		const itemId  = addItem({ groupId, tab, title, body, icon, actions })
		const toastId = toast ? pushToast({ groupId, kind: sticky ? 'offer' : 'info', title, body, icon, actions, sticky }) : null
		return { groupId, itemId, toastId }
	}

	const unreadCount = (tab) => items.value.filter(i => i.tab === tab && !i.read).length
	const tabItems    = (tab) => items.value.filter(i => i.tab === tab)
	const totalUnread = computed(() => items.value.filter(i => !i.read).length)

	return {
		toasts, items,
		pushToast, dismissToast, addItem, removeItem, markRead, clearTab, dismissGroup, notify,
		unreadCount, tabItems, totalUnread,
	}
})
