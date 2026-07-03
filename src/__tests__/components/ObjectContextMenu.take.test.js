// Tests for ObjectContextMenu — Take / Take copy wiring (FS menu_object.xml "Take"/"Take copy",
// pie order Return → Take → Take copy → Pay). Take sends the clicked prim's localId plus the
// Objects system folder UUID (typeDefault 6 = FS FT_OBJECT, llfoldertype.h:51) and falls back to
// the zero UUID when inventory hasn't loaded (OpenSim re-resolves the destination server-side,
// InventoryAccessModule.cs:814-851). Take copy sends only the localId — OpenSim forces the Objects
// folder for TakeCopy regardless of DestinationID. We mock useLLUDP to spy on the wire calls and
// use real Pinia stores for the menu + inventory state.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

// Spy on the LLUDP wire calls the menu rows invoke.
const sendTouch      = vi.fn()
const sendSit        = vi.fn()
const sendDelete     = vi.fn()
const takeObject     = vi.fn()
const takeObjectCopy = vi.fn()
vi.mock('@/composables/useLLUDP', () => ({
	useLLUDP: () => ({ sendTouch, sendSit, sendDelete, takeObject, takeObjectCopy }),
}))
// Silence the tick sound on click.
vi.mock('@/composables/useAudio', () => ({ playSound: vi.fn(), useAudio: () => ({ playSound: vi.fn() }) }))

import ObjectContextMenu from '@/components/ObjectContextMenu.vue'
import { useUiStore } from '@/stores/uiStore'
import { useInventoryStore } from '@/stores/inventoryStore'

const ZERO_UUID = '00000000-0000-0000-0000-000000000000'

let ui, inv

// Open the object menu on a fake prim and mount.
function openMenu() {
	ui.openObjectMenu({ localId: 42, fullId: 'full-42', name: 'Box', clickAction: 0, x: 10, y: 10 })
	return mount(ObjectContextMenu)
}
function clickLabel(w, text) {
	const btn = w.findAll('button').find(b => b.text() === text)
	expect(btn, `menu row "${text}" should exist and be enabled`).toBeTruthy()
	return btn.trigger('click')
}

beforeEach(() => {
	setActivePinia(createPinia())
	sendTouch.mockClear(); sendSit.mockClear(); sendDelete.mockClear()
	takeObject.mockClear(); takeObjectCopy.mockClear()
	ui  = useUiStore()
	inv = useInventoryStore()
})

describe('ObjectContextMenu — Take', () => {
	it('sends takeObject(localId, ObjectsFolderId) when the Objects system folder is known', async () => {
		inv.rootId = 'root-f'
		inv.folders.set('objects-f', { folderId: 'objects-f', parentId: 'root-f', name: 'Objects', typeDefault: 6, source: 'agent' })
		const w = openMenu()
		await clickLabel(w, 'Take')
		expect(takeObject).toHaveBeenCalledTimes(1)
		expect(takeObject).toHaveBeenCalledWith(42, 'objects-f')
		expect(ui.objectMenu).toBeNull()   // menu closes after the action
	})

	it('falls back to the zero UUID when inventory has not loaded (sim re-resolves)', async () => {
		const w = openMenu()
		await clickLabel(w, 'Take')
		expect(takeObject).toHaveBeenCalledWith(42, ZERO_UUID)
	})
})

describe('ObjectContextMenu — Take copy', () => {
	it('sends takeObjectCopy(localId) only — no destination folder, original stays in world', async () => {
		const w = openMenu()
		await clickLabel(w, 'Take copy')
		expect(takeObjectCopy).toHaveBeenCalledTimes(1)
		expect(takeObjectCopy).toHaveBeenCalledWith(42)
		expect(takeObject).not.toHaveBeenCalled()
		expect(ui.objectMenu).toBeNull()
	})
})
