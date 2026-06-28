import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useUiStore } from '@/stores/uiStore'

beforeEach(() => setActivePinia(createPinia()))

describe('uiStore profile (multi-instance)', () => {
	it('profileInstances defaults to empty; showProfile false', () => {
		const store = useUiStore()
		expect(store.profileInstances).toEqual([])
		expect(store.showProfile).toBe(false)
	})

	it('openProfile() opens self (null) instance and sets showProfile', () => {
		const store = useUiStore()
		store.openProfile()
		expect(store.profileInstances).toContain(null)
		expect(store.showProfile).toBe(true)
	})

	it('openProfile(id) adds a UUID instance without affecting self', () => {
		const store = useUiStore()
		store.openProfile('abc-123')
		expect(store.profileInstances).toContain('abc-123')
		expect(store.showProfile).toBe(false) // self not open
	})

	it('opens multiple distinct targets simultaneously', () => {
		const store = useUiStore()
		store.openProfile('abc-123')
		store.openProfile('def-456')
		store.openProfile() // self
		expect(store.profileInstances).toEqual(['abc-123', 'def-456', null])
	})

	it('openProfile is idempotent for the same target', () => {
		const store = useUiStore()
		store.openProfile('abc-123')
		store.openProfile('abc-123')
		expect(store.profileInstances).toEqual(['abc-123'])
	})

	it('closeProfile removes only the given target', () => {
		const store = useUiStore()
		store.openProfile('abc-123')
		store.openProfile('def-456')
		store.closeProfile('abc-123')
		expect(store.profileInstances).toEqual(['def-456'])
	})

	it('toggleProfile toggles the self instance', () => {
		const store = useUiStore()
		store.toggleProfile()
		expect(store.showProfile).toBe(true)
		store.toggleProfile()
		expect(store.showProfile).toBe(false)
	})
})

describe('uiStore — auto-open inventory on first load', () => {
	// WHY: the one-shot guard is module-level (survives store re-creation across SPA re-login),
	// so these assertions run in sequence within one module: first call opens, later calls no-op.
	it('autoOpenInventoryOnce opens inventory instance 0 on first call', () => {
		const store = useUiStore()
		expect(store.inventoryInstances).toEqual([])
		store.autoOpenInventoryOnce()
		expect(store.inventoryInstances).toEqual([0])
		expect(store.showInventory).toBe(true)
	})

	it('does not re-open after a manual close on a later (re-login) mount', () => {
		// Simulate user closing the auto-opened floater, then an SPA re-login re-mounts.
		const store = useUiStore()
		store.closeInventoryAt(0)
		expect(store.inventoryInstances).toEqual([])
		// Fresh store instance (re-login re-creates pinia) — guard already tripped this session.
		setActivePinia(createPinia())
		const store2 = useUiStore()
		store2.autoOpenInventoryOnce()
		expect(store2.inventoryInstances).toEqual([])
	})
})

describe('uiStore — movement help + preferences tab', () => {
	it('showMovementHelp defaults to false', () => {
		const store = useUiStore()
		expect(store.showMovementHelp).toBe(false)
	})

	it('toggleMovementHelp flips showMovementHelp', () => {
		const store = useUiStore()
		store.toggleMovementHelp()
		expect(store.showMovementHelp).toBe(true)
		store.toggleMovementHelp()
		expect(store.showMovementHelp).toBe(false)
	})

	it('preferenceActiveTab defaults to "appearance"', () => {
		const store = useUiStore()
		expect(store.preferenceActiveTab).toBe('appearance')
	})

	it('openPreferencesOnTab sets tab and shows preferences', () => {
		const store = useUiStore()
		store.openPreferencesOnTab('sound')
		expect(store.showPreferences).toBe(true)
		expect(store.showQuickPrefs).toBe(false)
		expect(store.preferenceActiveTab).toBe('sound')
	})
})
