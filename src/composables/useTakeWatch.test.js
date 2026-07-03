// useTakeWatch — the silent-refusal watchdog for Take / Take copy. OpenSim sends NO packet when
// it refuses a derez (PermissionsModule.cs:2017-2024, alert commented out), so the watchdog toasts
// after 10s unless an inventory ack disarms it.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { armTakeWatch, disarmTakeWatch } from '@/composables/useTakeWatch'
import { useNotificationStore } from '@/stores/notificationStore'

beforeEach(() => {
	setActivePinia(createPinia())
	vi.useFakeTimers()
})
afterEach(() => {
	disarmTakeWatch()   // never leak a pending timer into the next test
	vi.useRealTimers()
})

describe('useTakeWatch', () => {
	it('toasts after the window when no ack disarms it', () => {
		const notif = useNotificationStore()
		armTakeWatch('Take copy')
		vi.advanceTimersByTime(10000)
		expect(notif.toasts.length).toBe(1)
		expect(notif.toasts[0].body).toMatch(/Take copy wasn't confirmed/)
	})

	it('disarm (inventory ack) cancels the pending toast', () => {
		const notif = useNotificationStore()
		armTakeWatch('Take')
		disarmTakeWatch()
		vi.advanceTimersByTime(15000)
		expect(notif.toasts.length).toBe(0)
	})

	it('a burst of takes keeps a single pending hint (re-arm replaces)', () => {
		const notif = useNotificationStore()
		armTakeWatch('Take copy')
		vi.advanceTimersByTime(5000)
		armTakeWatch('Take copy')
		vi.advanceTimersByTime(9999)
		expect(notif.toasts.length).toBe(0)   // first timer was replaced, second not yet due
		vi.advanceTimersByTime(1)
		expect(notif.toasts.length).toBe(1)
	})
})
