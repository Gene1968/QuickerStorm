import { vi, describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// Mock IndexedDB — not available in test environment
vi.mock('@/composables/useIndexedDB.js', () => ({
	useIndexedDB: () => ({
		get: vi.fn().mockResolvedValue(null),
		set: vi.fn().mockResolvedValue(undefined),
	}),
}))

import { useAvatarStore } from '@/stores/avatarStore'

beforeEach(() => setActivePinia(createPinia()))

describe('avatarStore bio', () => {
	it('bio defaults to empty string', () => {
		const store = useAvatarStore()
		expect(store.bio).toBe('')
	})

	it('setBio updates bio value', async () => {
		const store = useAvatarStore()
		await store.setBio('Hello world')
		expect(store.bio).toBe('Hello world')
	})

	it('setBio trims whitespace', async () => {
		const store = useAvatarStore()
		await store.setBio('  hello  ')
		expect(store.bio).toBe('hello')
	})

	it('setBio with null sets empty string', async () => {
		const store = useAvatarStore()
		await store.setBio(null)
		expect(store.bio).toBe('')
	})
})
