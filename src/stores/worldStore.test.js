import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useWorldStore } from './worldStore'

describe('worldStore clickAction', () => {
	beforeEach(() => { setActivePinia(createPinia()) })

	it('stores clickAction from upsertObject', () => {
		const store = useWorldStore()
		store.upsertObject({ localId: 1, fullId: 'aaa', clickAction: 2 })
		expect(store.objects.get(1).clickAction).toBe(2)
	})

	it('defaults clickAction to 0 when absent', () => {
		const store = useWorldStore()
		store.upsertObject({ localId: 2, fullId: 'bbb' })
		expect(store.objects.get(2).clickAction).toBe(0)
	})

	it('preserves existing clickAction when omitted in subsequent update', () => {
		const store = useWorldStore()
		store.upsertObject({ localId: 3, fullId: 'ccc', clickAction: 6 })
		store.upsertObject({ localId: 3, fullId: 'ccc', pos: [1, 2, 3] })
		expect(store.objects.get(3).clickAction).toBe(6)
	})
})
