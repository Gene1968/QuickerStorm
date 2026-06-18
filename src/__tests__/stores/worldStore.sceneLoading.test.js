import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useWorldStore } from '@/stores/worldStore'

beforeEach(() => setActivePinia(createPinia()))

describe('worldStore.sceneLoading', () => {
	it('defaults to true (assume loading until the engine reports a settle)', () => {
		const w = useWorldStore()
		expect(w.sceneLoading).toBe(true)
	})

	it('setSceneLoading coerces to boolean', () => {
		const w = useWorldStore()
		w.setSceneLoading(false)
		expect(w.sceneLoading).toBe(false)
		w.setSceneLoading(1)
		expect(w.sceneLoading).toBe(true)
		w.setSceneLoading(0)
		expect(w.sceneLoading).toBe(false)
	})
})

describe('worldStore.assetProgress', () => {
	it('defaults to 0', () => {
		const w = useWorldStore()
		expect(w.assetProgress).toBe(0)
	})

	it('setAssetProgress stores a floored integer (monotonic asset-completion counter)', () => {
		const w = useWorldStore()
		w.setAssetProgress(42)
		expect(w.assetProgress).toBe(42)
		w.setAssetProgress(7.9)
		expect(w.assetProgress).toBe(7)
	})
})
