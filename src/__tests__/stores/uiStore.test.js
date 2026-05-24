import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useUiStore } from '@/stores/uiStore'

beforeEach(() => setActivePinia(createPinia()))

describe('uiStore profile', () => {
	it('showProfile defaults to false', () => {
		const store = useUiStore()
		expect(store.showProfile).toBe(false)
	})

	it('profileTargetId defaults to null', () => {
		const store = useUiStore()
		expect(store.profileTargetId).toBe(null)
	})

	it('openProfile() sets showProfile=true and targetId=null', () => {
		const store = useUiStore()
		store.openProfile()
		expect(store.showProfile).toBe(true)
		expect(store.profileTargetId).toBe(null)
	})

	it('openProfile(id) sets targetId to given UUID', () => {
		const store = useUiStore()
		store.openProfile('abc-123')
		expect(store.showProfile).toBe(true)
		expect(store.profileTargetId).toBe('abc-123')
	})

	it('toggleProfile toggles showProfile', () => {
		const store = useUiStore()
		store.toggleProfile()
		expect(store.showProfile).toBe(true)
		store.toggleProfile()
		expect(store.showProfile).toBe(false)
	})
})
