// ObjectContextMenu — Link/Unlink rows (PACKAGE 4, 2026-07-13). Gating logic itself is covered
// exhaustively in src/utils/linkGating.test.js; this asserts the row wiring (show/hide, invoke,
// selection-vs-clicked-target resolution, toast on known-different-owner refusal).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

const sendTouch      = vi.fn()
const sendSit        = vi.fn()
const sendDelete     = vi.fn()
const takeObject     = vi.fn()
const takeObjectCopy = vi.fn()
const sendLink       = vi.fn()
const sendDelink     = vi.fn()
vi.mock('@/composables/useLLUDP', () => ({
	useLLUDP: () => ({ sendTouch, sendSit, sendDelete, takeObject, takeObjectCopy, sendLink, sendDelink }),
}))
vi.mock('@/composables/useAudio', () => ({ playSound: vi.fn(), useAudio: () => ({ playSound: vi.fn() }) }))

import ObjectContextMenu from '@/components/ObjectContextMenu.vue'
import { useUiStore } from '@/stores/uiStore'
import { useWorldStore, PCODE_PRIM } from '@/stores/worldStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useNotificationStore } from '@/stores/notificationStore'

const AGENT = 'AAAAAAAA-1111-2222-3333-444444444444'
const OTHER = 'BBBBBBBB-1111-2222-3333-444444444444'

let ui, world, session, notif

function openMenu(localId, extra = {}) {
	const o = world.objects.get(localId)
	ui.openObjectMenu({ localId, fullId: o?.fullId ?? `full-${localId}`, name: o?.name || 'Box', clickAction: 0, x: 10, y: 10, ...extra })
	return mount(ObjectContextMenu)
}
function findRow(w, text) { return w.findAll('button').find(b => b.text() === text) }

beforeEach(() => {
	setActivePinia(createPinia())
	sendLink.mockClear(); sendDelink.mockClear()
	ui = useUiStore()
	world = useWorldStore()
	session = useSessionStore()
	notif = useNotificationStore()
	session.agentId = AGENT
})

describe('ObjectContextMenu — Unlink visibility (FS pie parity)', () => {
	it('hidden entirely when the clicked prim is a standalone (no linkset)', () => {
		world.upsertObject({ localId: 1, fullId: 'f1', pcode: PCODE_PRIM })
		const w = openMenu(1)
		expect(findRow(w, 'Unlink')).toBeFalsy()
	})
	it('shown (enabled) when the clicked prim is the root of a multi-prim linkset', () => {
		world.upsertObject({ localId: 1, fullId: 'f1', pcode: PCODE_PRIM })
		world.upsertObject({ localId: 2, fullId: 'f2', pcode: PCODE_PRIM, parentId: 1 })
		const w = openMenu(1)
		const row = findRow(w, 'Unlink')
		expect(row).toBeTruthy()
		expect(row.attributes('disabled')).toBeUndefined()
	})
	it('Unlink click delinks every member of the clicked prim\'s linkset', async () => {
		world.upsertObject({ localId: 1, fullId: 'f1', pcode: PCODE_PRIM })
		world.upsertObject({ localId: 2, fullId: 'f2', pcode: PCODE_PRIM, parentId: 1 })
		const w = openMenu(2)   // right-click a CHILD prim
		const row = findRow(w, 'Unlink')
		await row.trigger('click')
		expect(sendDelink).toHaveBeenCalledWith([1, 2])
		expect(ui.objectMenu).toBeNull()
	})
})

describe('ObjectContextMenu — Link', () => {
	it('disabled (no title-worthy toast) when only one root is targeted', () => {
		world.upsertObject({ localId: 1, fullId: 'f1', pcode: PCODE_PRIM })
		const w = openMenu(1)
		const row = findRow(w, 'Link')
		expect(row.attributes('disabled')).toBeDefined()
	})
	it('enabled when right-clicking a member of an active multi-select (2 distinct roots)', async () => {
		world.upsertObject({ localId: 1, fullId: 'f1', pcode: PCODE_PRIM, ownerId: AGENT })
		world.upsertObject({ localId: 2, fullId: 'f2', pcode: PCODE_PRIM, ownerId: AGENT })
		ui.editObjectId = 1
		ui.selectedObjectIds = [2]
		const w = openMenu(1)   // clicked prim (1) IS the active primary selection
		const row = findRow(w, 'Link')
		expect(row.attributes('disabled')).toBeUndefined()
		await row.trigger('click')
		expect(sendLink).toHaveBeenCalledWith([1, 2])
		expect(ui.selectedObjectIds).toEqual([])
	})
	it('right-clicking OUTSIDE the active selection retargets to just the clicked prim (disabled, single object)', () => {
		world.upsertObject({ localId: 1, fullId: 'f1', pcode: PCODE_PRIM })
		world.upsertObject({ localId: 2, fullId: 'f2', pcode: PCODE_PRIM })
		world.upsertObject({ localId: 3, fullId: 'f3', pcode: PCODE_PRIM })
		ui.editObjectId = 1
		ui.selectedObjectIds = [2]
		const w = openMenu(3)   // clicked prim (3) is NOT part of the [1,2] selection
		const row = findRow(w, 'Link')
		expect(row.attributes('disabled')).toBeDefined()
	})
	it('known-different owners → disabled + toasts "Unable to link"', async () => {
		world.upsertObject({ localId: 1, fullId: 'f1', pcode: PCODE_PRIM, ownerId: AGENT })
		world.upsertObject({ localId: 2, fullId: 'f2', pcode: PCODE_PRIM, ownerId: OTHER })
		ui.editObjectId = 1
		ui.selectedObjectIds = [2]
		const w = openMenu(1)
		const row = findRow(w, 'Link')
		expect(row.attributes('disabled')).toBeDefined()
		expect(row.attributes('title')).toBe('Not all of the objects have the same owner')
	})
})
