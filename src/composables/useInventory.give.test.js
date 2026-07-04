// Give-path "nothing sent" coverage: every path where giveInventory / giveInventoryFolder /
// shareToAgent sends NOTHING must toast (a silent no-op on a drop reads as data loss).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { C } from '@shared/protocol.js'

const emitSpy = vi.fn()
vi.mock('@/composables/useRealtimeSocket', () => ({
	useRealtimeSocket: () => ({ on: vi.fn(), off: vi.fn(), emit: emitSpy }),
}))
vi.mock('@/composables/useLLUDP', () => ({
	useLLUDP: () => ({ purgeInventoryFolder: vi.fn() }),
}))
vi.mock('@/composables/useAudio', () => ({ playSound: vi.fn() }))

import { useInventory } from '@/composables/useInventory'
import { useInventoryStore } from '@/stores/inventoryStore'
import { useNotificationStore } from '@/stores/notificationStore'

// Emits that actually offer inventory (both item + folder give routes).
const giveEmits = () => emitSpy.mock.calls.filter(
	([msg]) => msg === C.GIVE_INVENTORY || msg === C.GIVE_INVENTORY_FOLDER)

function seedItems(inv) {
	inv.items.set('f1', [
		{ itemId: 'obj-ok',      name: 'Box',    assetType: 6, canTransfer: true },
		{ itemId: 'obj-notrans', name: 'NoGive', assetType: 6, canTransfer: false },
	])
}

describe('giveInventory nothing-sent paths', () => {
	let give, inv, notif
	beforeEach(() => {
		setActivePinia(createPinia())
		emitSpy.mockClear()
		inv   = useInventoryStore()
		notif = useNotificationStore()
		seedItems(inv)
		give = useInventory()
	})

	it('no recipient → exactly one toast, zero gives', () => {
		give.giveInventory(['obj-ok'], '', 'Nobody')
		expect(giveEmits().length).toBe(0)
		expect(notif.toasts.length).toBe(1)
		expect(notif.toasts[0].title).toBe('Nothing shared')
	})

	it('all ids unresolved by findItem → exactly one toast, zero gives', () => {
		give.giveInventory(['gone-1', 'gone-2'], 'agent-1', 'Bob')
		expect(giveEmits().length).toBe(0)
		expect(notif.toasts.length).toBe(1)
		expect(notif.toasts[0].title).toBe('Nothing shared')
		expect(notif.toasts[0].body).toMatch(/not found/)
	})

	it('all blocked (no-transfer) → exactly one toast (blocked), zero gives, no "not found"', () => {
		give.giveInventory(['obj-notrans'], 'agent-1', 'Bob')
		expect(giveEmits().length).toBe(0)
		expect(notif.toasts.length).toBe(1)
		expect(notif.toasts[0].title).toBe('Not transferable')
	})

	it('mixed givable + blocked → one give emit, success toast AND blocked toast', () => {
		give.giveInventory(['obj-ok', 'obj-notrans'], 'agent-1', 'Bob')
		const gives = giveEmits()
		expect(gives.length).toBe(1)
		expect(gives[0][1]).toMatchObject({ toAgentId: 'agent-1', itemId: 'obj-ok' })
		const titles = notif.toasts.map(t => t.title)
		expect(titles).toContain('Inventory')
		expect(titles).toContain('Not transferable')
		expect(notif.toasts.length).toBe(2)
	})

	it('happy path unchanged: one emit, one success toast', () => {
		give.giveInventory('obj-ok', 'agent-1', 'Bob')
		expect(giveEmits().length).toBe(1)
		expect(notif.toasts.length).toBe(1)
		expect(notif.toasts[0].title).toBe('Inventory')
	})
})

describe('giveInventoryFolder nothing-sent paths', () => {
	let give, inv, notif
	beforeEach(() => {
		setActivePinia(createPinia())
		emitSpy.mockClear()
		inv   = useInventoryStore()
		notif = useNotificationStore()
		give = useInventory()
	})

	it('no recipient → toast, zero gives', async () => {
		await give.giveInventoryFolder('folder-1', '', 'Nobody')
		expect(giveEmits().length).toBe(0)
		expect(notif.toasts.length).toBe(1)
		expect(notif.toasts[0].title).toBe('Nothing shared')
	})

	it('missing folderId → toast, zero gives', async () => {
		await give.giveInventoryFolder('', 'agent-1', 'Bob')
		expect(giveEmits().length).toBe(0)
		expect(notif.toasts.length).toBe(1)
		expect(notif.toasts[0].title).toBe('Nothing shared')
	})

	it('folder not in store → toast, zero gives', async () => {
		await give.giveInventoryFolder('no-such-folder', 'agent-1', 'Bob')
		expect(giveEmits().length).toBe(0)
		expect(notif.toasts.length).toBe(1)
		expect(notif.toasts[0].body).toMatch(/Folder not found/)
	})
})

describe('shareToAgent nothing-sent paths', () => {
	let give, notif
	beforeEach(() => {
		setActivePinia(createPinia())
		emitSpy.mockClear()
		notif = useNotificationStore()
		give = useInventory()
	})

	it('empty / all-falsy id list → exactly one toast, zero gives', () => {
		give.shareToAgent([], 'agent-1', 'Bob')
		give.shareToAgent([null, undefined, ''], 'agent-1', 'Bob')
		expect(giveEmits().length).toBe(0)
		expect(notif.toasts.length).toBe(2)   // one per call
		expect(notif.toasts.every(t => t.title === 'Nothing shared')).toBe(true)
	})
})
