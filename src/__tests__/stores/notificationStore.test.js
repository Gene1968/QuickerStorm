import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useNotificationStore } from '@/stores/notificationStore'

beforeEach(() => setActivePinia(createPinia()))

describe('notificationStore', () => {
	it('pushToast adds newest-first and dismissToast removes by id', () => {
		const s = useNotificationStore()
		const a = s.pushToast({ title: 'A' })
		const b = s.pushToast({ title: 'B' })
		expect(s.toasts.map(t => t.id)).toEqual([b, a])
		s.dismissToast(a)
		expect(s.toasts.map(t => t.id)).toEqual([b])
	})

	it('addItem + unreadCount + markRead + clearTab', () => {
		const s = useNotificationStore()
		const id = s.addItem({ tab: 'system', title: 'hi' })
		s.addItem({ tab: 'group', title: 'g' })
		expect(s.unreadCount('system')).toBe(1)
		expect(s.totalUnread).toBe(2)
		s.markRead(id)
		expect(s.unreadCount('system')).toBe(0)
		s.clearTab('group')
		expect(s.tabItems('group')).toEqual([])
	})

	it('notify links toast + item under a group; dismissGroup clears both', () => {
		const s = useNotificationStore()
		const { groupId, itemId, toastId } = s.notify({ tab: 'system', title: 'offer', sticky: true })
		expect(s.toasts.find(t => t.id === toastId)).toBeTruthy()
		expect(s.items.find(i => i.id === itemId)).toBeTruthy()
		s.dismissGroup(groupId)
		expect(s.toasts.length).toBe(0)
		expect(s.items.length).toBe(0)
	})

	it('notify with toast:false adds an item but no toast', () => {
		const s = useNotificationStore()
		const { toastId } = s.notify({ tab: 'system', title: 'x', toast: false })
		expect(toastId).toBe(null)
		expect(s.items.length).toBe(1)
		expect(s.toasts.length).toBe(0)
	})
})
