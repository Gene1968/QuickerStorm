// ObjectContextMenu — right-click-menu sweep (Sit here/Stand Up, Buy, Pay, Zoom in).
// Sit/Stand-up/Zoom bridge to useWorldEngine.js via window CustomEvents ('qs:stand-up',
// 'qs:zoom-to-object') because WorldCanvas.vue doesn't currently forward those functions out of
// the composable's closure (see this component's task report) — we assert the dispatch itself,
// not the engine's reaction (that half is covered once the bridge lands upstream).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

const sendTouch      = vi.fn()
const sendSit        = vi.fn()
const sendDelete     = vi.fn()
const takeObject     = vi.fn()
const takeObjectCopy = vi.fn()
vi.mock('@/composables/useLLUDP', () => ({
	useLLUDP: () => ({ sendTouch, sendSit, sendDelete, takeObject, takeObjectCopy }),
}))
vi.mock('@/composables/useAudio', () => ({ playSound: vi.fn(), useAudio: () => ({ playSound: vi.fn() }) }))

import ObjectContextMenu from '@/components/ObjectContextMenu.vue'
import { useUiStore } from '@/stores/uiStore'
import { useWorldStore, PCODE_PRIM, PCODE_AVATAR } from '@/stores/worldStore'
import { useSessionStore } from '@/stores/sessionStore'

const AGENT = 'AAAAAAAA-1111-2222-3333-444444444444'
const OTHER = 'BBBBBBBB-1111-2222-3333-444444444444'

let ui, world, session

function openMenu(extra = {}) {
	ui.openObjectMenu({ localId: 42, fullId: 'full-42', name: 'Box', clickAction: 0, x: 10, y: 10, ...extra })
	return mount(ObjectContextMenu)
}
function findRow(w, text) { return w.findAll('button').find(b => b.text() === text) }
function findFlyoutRow(w, text) {
	// Submenu rows ('Zoom in' lives under 'Object') render inside a hidden .cmi-flyout — still
	// present in the DOM (CSS-only hover reveal), so a plain findAll works.
	return w.findAll('button').find(b => b.text() === text)
}

beforeEach(() => {
	setActivePinia(createPinia())
	sendTouch.mockClear(); sendSit.mockClear(); sendDelete.mockClear()
	takeObject.mockClear(); takeObjectCopy.mockClear()
	ui = useUiStore()
	world = useWorldStore()
	session = useSessionStore()
	session.agentId = AGENT
})

describe('ObjectContextMenu — Sit here / Stand Up', () => {
	it('"Sit here" sends sendSit with the clicked prim\'s fullId + the pick offset (FS pick.mObjectOffset, llviewermenu.cpp:6013)', async () => {
		world.upsertObject({ localId: 42, fullId: 'full-42', pcode: PCODE_PRIM })
		const w = openMenu({ objectOffset: [0.2, -0.1, 0.9] })
		const row = findRow(w, 'Sit here')
		expect(row).toBeTruthy()
		await row.trigger('click')
		expect(sendSit).toHaveBeenCalledWith('full-42', [0.2, -0.1, 0.9])
		expect(ui.objectMenu).toBeNull()
	})

	it('uses the object\'s sitName as the row label when ObjectProperties provided one', () => {
		world.upsertObject({ localId: 42, fullId: 'full-42', pcode: PCODE_PRIM, sitName: 'Sit on the throne' })
		const w = openMenu()
		expect(findRow(w, 'Sit on the throne')).toBeTruthy()
		expect(findRow(w, 'Sit here')).toBeFalsy()
	})

	it('shows "Stand Up" (not "Sit here") when the own avatar is seated on THIS object, and dispatches qs:stand-up', async () => {
		world.upsertObject({ localId: 42, fullId: 'full-42', pcode: PCODE_PRIM })
		world.upsertObject({ localId: 99, fullId: AGENT, pcode: PCODE_AVATAR, parentId: 42 })
		ui.setSitting('object')
		const w = openMenu()
		expect(findRow(w, 'Sit here')).toBeFalsy()
		const row = findRow(w, 'Stand Up')
		expect(row).toBeTruthy()
		const spy = vi.fn()
		window.addEventListener('qs:stand-up', spy)
		await row.trigger('click')
		expect(spy).toHaveBeenCalledTimes(1)
		expect(sendSit).not.toHaveBeenCalled()
		expect(ui.objectMenu).toBeNull()
		window.removeEventListener('qs:stand-up', spy)
	})

	it('does NOT show "Stand Up" when seated on a DIFFERENT object', () => {
		world.upsertObject({ localId: 42, fullId: 'full-42', pcode: PCODE_PRIM })
		world.upsertObject({ localId: 99, fullId: AGENT, pcode: PCODE_AVATAR, parentId: 7 })
		ui.setSitting('object')
		const w = openMenu()
		expect(findRow(w, 'Stand Up')).toBeFalsy()
		expect(findRow(w, 'Sit here')).toBeTruthy()
	})
})

describe('ObjectContextMenu — Buy', () => {
	it('disabled when the object is not for sale (saleType 0)', () => {
		world.upsertObject({ localId: 42, fullId: 'full-42', pcode: PCODE_PRIM })
		world.applyObjectProperties({ fullId: 'full-42', ownerId: OTHER, saleType: 0, salePrice: 0 })
		const w = openMenu()
		const row = findRow(w, 'Buy (L$0)')
		expect(row).toBeTruthy()
		expect(row.attributes('disabled')).toBeDefined()
	})

	it('disabled when for-sale but owned by self', () => {
		world.upsertObject({ localId: 42, fullId: 'full-42', pcode: PCODE_PRIM })
		world.applyObjectProperties({ fullId: 'full-42', ownerId: AGENT, saleType: 1, salePrice: 500 })
		const w = openMenu()
		const row = findRow(w, 'Buy (L$500)')
		expect(row.attributes('disabled')).toBeDefined()
	})

	it('enabled + priced label when for-sale and owned by someone else; opens BuyObjectDialog', async () => {
		world.upsertObject({ localId: 42, fullId: 'full-42', pcode: PCODE_PRIM })
		world.applyObjectProperties({ fullId: 'full-42', ownerId: OTHER, saleType: 1, salePrice: 500 })
		const w = openMenu()
		const row = findRow(w, 'Buy (L$500)')
		expect(row.attributes('disabled')).toBeUndefined()
		await row.trigger('click')
		expect(ui.buyDialogTarget).toEqual({ localId: 42 })
		expect(ui.objectMenu).toBeNull()
	})
})

describe('ObjectContextMenu — Pay', () => {
	it('always enabled; opens PayFloater targeting the object', async () => {
		world.upsertObject({ localId: 42, fullId: 'full-42', pcode: PCODE_PRIM })
		const w = openMenu()
		const row = findRow(w, 'Pay')
		expect(row.attributes('disabled')).toBeUndefined()
		await row.trigger('click')
		expect(ui.payTarget).toEqual({ targetId: 'full-42', targetName: 'Box', kind: 'object' })
		expect(ui.objectMenu).toBeNull()
	})
})

describe('ObjectContextMenu — Zoom in', () => {
	it('dispatches qs:zoom-to-object with the clicked localId', async () => {
		world.upsertObject({ localId: 42, fullId: 'full-42', pcode: PCODE_PRIM })
		const w = openMenu()
		const row = findFlyoutRow(w, 'Zoom in')
		expect(row).toBeTruthy()
		const spy = vi.fn()
		window.addEventListener('qs:zoom-to-object', spy)
		await row.trigger('click')
		expect(spy).toHaveBeenCalledTimes(1)
		expect(spy.mock.calls[0][0].detail).toEqual({ localId: 42 })
		window.removeEventListener('qs:zoom-to-object', spy)
	})
})
