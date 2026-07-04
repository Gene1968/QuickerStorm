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

import { nextTick } from 'vue'
import ObjectContextMenu from '@/components/ObjectContextMenu.vue'
import { useUiStore } from '@/stores/uiStore'
import { useInventoryStore } from '@/stores/inventoryStore'
import { useWorldStore, PCODE_PRIM } from '@/stores/worldStore'
import { useSessionStore } from '@/stores/sessionStore'
import { PERM_TRANSFER, PERM_MODIFY, PERM_COPY } from '@/utils/objectPermissions'

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

// PACKAGE C — perm gating on the Take / Take copy rows (client prediction of OpenSim
// CanTakeObject/CanTakeCopyObject, PermissionsModule.cs:1963/2004, via takeGating.js).
// The gate truth tables live in takeGating.test.js / objectPermissions.test.js; here we
// verify the menu WIRING: disabled attr + explanatory title on the rendered rows, and the
// live re-gate when ObjectProperties arrives after the menu is already open.
describe('ObjectContextMenu — Take / Take copy perm gating', () => {
	const AGENT = 'AAAAAAAA-1111-2222-3333-444444444444'
	const OTHER = 'BBBBBBBB-1111-2222-3333-444444444444'

	const findRow = (w, text) => w.findAll('button').find(b => b.text() === text)

	it('unknown perms (no ObjectProperties yet) → both rows ENABLED per convention', () => {
		const world = useWorldStore()
		world.upsertObject({ localId: 42, fullId: 'full-42', pcode: PCODE_PRIM })
		const w = openMenu()
		expect(findRow(w, 'Take').attributes('disabled')).toBeUndefined()
		expect(findRow(w, 'Take copy').attributes('disabled')).toBeUndefined()
	})

	it("someone else's locked-down object → both rows disabled with explanatory titles", () => {
		useSessionStore().agentId = AGENT
		const world = useWorldStore()
		world.upsertObject({ localId: 42, fullId: 'full-42', pcode: PCODE_PRIM })
		world.applyObjectProperties({ fullId: 'full-42', ownerId: OTHER, ownerMask: 0, everyoneMask: 0 })
		const w = openMenu()
		const take = findRow(w, 'Take')
		expect(take.attributes('disabled')).toBeDefined()
		expect(take.attributes('title')).toBe("You don't own this object and it isn't transferable")
		const copy = findRow(w, 'Take copy')
		expect(copy.attributes('disabled')).toBeDefined()
		expect(copy.attributes('title')).toBe('Object is not copyable')
	})

	it("own no-copy object → Take enabled, Take copy disabled ('Object is not copyable')", () => {
		useSessionStore().agentId = AGENT
		const world = useWorldStore()
		world.upsertObject({ localId: 42, fullId: 'full-42', pcode: PCODE_PRIM })
		world.applyObjectProperties({ fullId: 'full-42', ownerId: AGENT, ownerMask: PERM_TRANSFER | PERM_MODIFY, everyoneMask: 0 })
		const w = openMenu()
		expect(findRow(w, 'Take').attributes('disabled')).toBeUndefined()
		const copy = findRow(w, 'Take copy')
		expect(copy.attributes('disabled')).toBeDefined()
		expect(copy.attributes('title')).toBe('Object is not copyable')
	})

	it("everyone transfer+modify+copy on another's object → both rows enabled", () => {
		useSessionStore().agentId = AGENT
		const world = useWorldStore()
		world.upsertObject({ localId: 42, fullId: 'full-42', pcode: PCODE_PRIM })
		world.applyObjectProperties({ fullId: 'full-42', ownerId: OTHER, ownerMask: 0, everyoneMask: PERM_TRANSFER | PERM_MODIFY | PERM_COPY })
		const w = openMenu()
		expect(findRow(w, 'Take').attributes('disabled')).toBeUndefined()
		expect(findRow(w, 'Take copy').attributes('disabled')).toBeUndefined()
	})

	it('ObjectProperties arriving AFTER the menu opens re-gates live (enabled → disabled flip)', async () => {
		useSessionStore().agentId = AGENT
		const world = useWorldStore()
		world.upsertObject({ localId: 42, fullId: 'full-42', pcode: PCODE_PRIM })
		const w = openMenu()
		expect(findRow(w, 'Take').attributes('disabled')).toBeUndefined()   // unknown → enabled
		world.applyObjectProperties({ fullId: 'full-42', ownerId: OTHER, ownerMask: 0, everyoneMask: 0 })
		await nextTick()
		expect(findRow(w, 'Take').attributes('disabled')).toBeDefined()
		expect(findRow(w, 'Take copy').attributes('disabled')).toBeDefined()
	})
})
