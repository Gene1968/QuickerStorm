// MenuBar — Build ▸ Link/Unlink rows + Ctrl+L / Ctrl+⇧+L shortcuts (PACKAGE 4, 2026-07-13).
// Gating logic itself is covered exhaustively in src/utils/linkGating.test.js; this asserts the
// row + keyboard wiring against the SAME uiStore selection ObjectContextMenu's rows use.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('/favicon.svg', () => ({ default: '' }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/composables/useRealtimeSocket', () => ({ useRealtimeSocket: () => ({ emit: vi.fn() }) }))
vi.mock('@/composables/useAudio.js', () => ({ playSound: vi.fn(), useAudio: () => ({ playSound: vi.fn() }) }))
vi.mock('@/composables/useTeleport.js', () => ({ useTeleport: () => ({ requestHomeTeleport: vi.fn(), setHomeHere: vi.fn() }) }))
const takeObject = vi.fn(), takeObjectCopy = vi.fn(), sendDelete = vi.fn()
const sendLink = vi.fn(), sendDelink = vi.fn()
vi.mock('@/composables/useLLUDP', () => ({
	useLLUDP: () => ({ takeObject, takeObjectCopy, sendDelete, sendLink, sendDelink }),
}))

import MenuBar from '@/components/MenuBar.vue'
import { useUiStore } from '@/stores/uiStore'
import { useWorldStore, PCODE_PRIM } from '@/stores/worldStore'
import { useSessionStore } from '@/stores/sessionStore'

const AGENT = 'AAAAAAAA-1111-2222-3333-444444444444'
const OTHER = 'BBBBBBBB-1111-2222-3333-444444444444'

let ui, world, session

function mountOpenBuildMenu() {
	const w = mount(MenuBar)
	w.findAll('button').find(b => b.text() === 'Build').trigger('click')
	return w
}
// Rows with a `kbd` shortcut render "Link" + "Ctrl+L" as sibling spans in the SAME button, so a
// plain b.text() match (whole-button text) fails on these — match the label span only.
function findLabeled(w, text) {
	return w.findAll('button').find(b => {
		const label = b.find('.mb-item-label')
		return label.exists() && label.text() === text
	})
}

beforeEach(() => {
	setActivePinia(createPinia())
	sendLink.mockClear(); sendDelink.mockClear()
	ui = useUiStore()
	world = useWorldStore()
	session = useSessionStore()
	session.agentId = AGENT
})

describe('MenuBar — Build ▸ Link / Unlink rows', () => {
	it('both disabled with nothing selected', async () => {
		const w = mountOpenBuildMenu()
		await w.vm.$nextTick()
		expect(findLabeled(w, 'Link').attributes('disabled')).toBeDefined()
		expect(findLabeled(w, 'Unlink').attributes('disabled')).toBeDefined()
	})

	it('Link enabled with 2 selected roots (same owner); click sends sendLink(roots) newest-first', async () => {
		world.upsertObject({ localId: 1, fullId: 'f1', pcode: PCODE_PRIM, ownerId: AGENT })
		world.upsertObject({ localId: 2, fullId: 'f2', pcode: PCODE_PRIM, ownerId: AGENT })
		ui.editObjectId = 2
		ui.selectedObjectIds = [1]
		const w = mountOpenBuildMenu()
		await w.vm.$nextTick()
		const row = findLabeled(w, 'Link')
		expect(row.attributes('disabled')).toBeUndefined()
		await row.trigger('click')
		expect(sendLink).toHaveBeenCalledWith([2, 1])
		expect(ui.selectedObjectIds).toEqual([])
	})

	it('Unlink enabled when the primary selection is part of a multi-prim linkset', async () => {
		world.upsertObject({ localId: 1, fullId: 'f1', pcode: PCODE_PRIM })
		world.upsertObject({ localId: 2, fullId: 'f2', pcode: PCODE_PRIM, parentId: 1 })
		ui.editObjectId = 1
		const w = mountOpenBuildMenu()
		await w.vm.$nextTick()
		const row = findLabeled(w, 'Unlink')
		expect(row.attributes('disabled')).toBeUndefined()
		await row.trigger('click')
		expect(sendDelink).toHaveBeenCalledWith([1, 2])
	})
})

describe('MenuBar — Ctrl+L / Ctrl+⇧+L shortcuts', () => {
	it('Ctrl+L links the current selection', () => {
		world.upsertObject({ localId: 1, fullId: 'f1', pcode: PCODE_PRIM, ownerId: AGENT })
		world.upsertObject({ localId: 2, fullId: 'f2', pcode: PCODE_PRIM, ownerId: AGENT })
		ui.editObjectId = 2
		ui.selectedObjectIds = [1]
		mount(MenuBar)
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', ctrlKey: true }))
		expect(sendLink).toHaveBeenCalledWith([2, 1])
	})

	it('Ctrl+Shift+L unlinks the current selection', () => {
		world.upsertObject({ localId: 1, fullId: 'f1', pcode: PCODE_PRIM })
		world.upsertObject({ localId: 2, fullId: 'f2', pcode: PCODE_PRIM, parentId: 1 })
		ui.editObjectId = 1
		mount(MenuBar)
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', ctrlKey: true, shiftKey: true }))
		expect(sendDelink).toHaveBeenCalledWith([1, 2])
	})

	it('Ctrl+L on known-different owners does NOT send and toasts a refusal', () => {
		world.upsertObject({ localId: 1, fullId: 'f1', pcode: PCODE_PRIM, ownerId: AGENT })
		world.upsertObject({ localId: 2, fullId: 'f2', pcode: PCODE_PRIM, ownerId: OTHER })
		ui.editObjectId = 1
		ui.selectedObjectIds = [2]
		mount(MenuBar)
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', ctrlKey: true }))
		expect(sendLink).not.toHaveBeenCalled()
	})
})
