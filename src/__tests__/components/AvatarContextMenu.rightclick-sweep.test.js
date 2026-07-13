// AvatarContextMenu — right-click-menu sweep: self (Sit down/Stand up) + other-avatar
// (Zoom in, Pay, Invite to group, Inspect). Sit-down/Stand-up/Zoom bridge to useWorldEngine.js
// via window CustomEvents ('qs:sit-ground', 'qs:stand-up', 'qs:zoom-to-object') because
// WorldCanvas.vue doesn't currently forward those functions out of the composable's closure (see
// this component's task report) — we assert the dispatch itself, not the engine's reaction.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

const inviteToGroup = vi.fn()
vi.mock('@/composables/useLLUDP', () => ({
	useLLUDP: () => ({ inviteToGroup }),
}))
vi.mock('@/composables/useAudio', () => ({ playSound: vi.fn(), useAudio: () => ({ playSound: vi.fn() }) }))
const openWith = vi.fn()
vi.mock('@/composables/useInstantMessage', () => ({ useInstantMessage: () => ({ openWith }) }))
const offerFriendship = vi.fn()
vi.mock('@/composables/useSocial', () => ({ useSocial: () => ({ offerFriendship }) }))

import AvatarContextMenu from '@/components/AvatarContextMenu.vue'
import { useUiStore } from '@/stores/uiStore'
import { useGridSocialStore } from '@/stores/gridSocialStore'

let ui, social

function openMenu(extra = {}) {
	ui.openAvatarMenu({ agentId: 'agent-1', localId: 7, name: 'Jane Doe', isSelf: false, x: 10, y: 10, ...extra })
	return mount(AvatarContextMenu)
}
function findRow(w, text) { return w.findAll('button').find(b => b.text() === text) }

beforeEach(() => {
	setActivePinia(createPinia())
	inviteToGroup.mockClear(); openWith.mockClear(); offerFriendship.mockClear()
	ui = useUiStore()
	social = useGridSocialStore()
})

describe('AvatarContextMenu — self: Sit down / Stand up', () => {
	function openSelf() {
		ui.openAvatarMenu({ agentId: 'self-1', localId: 1, name: 'Me', isSelf: true, x: 10, y: 10 })
		return mount(AvatarContextMenu)
	}

	it('"Sit down" enabled while standing; dispatches qs:sit-ground', async () => {
		const w = openSelf()
		const row = findRow(w, 'Sit down')
		expect(row.attributes('disabled')).toBeUndefined()
		const spy = vi.fn()
		window.addEventListener('qs:sit-ground', spy)
		await row.trigger('click')
		expect(spy).toHaveBeenCalledTimes(1)
		expect(ui.avatarMenu).toBeNull()
		window.removeEventListener('qs:sit-ground', spy)
	})

	it('"Stand up" disabled while standing, enabled while seated; dispatches qs:stand-up', async () => {
		let w = openSelf()
		expect(findRow(w, 'Stand up').attributes('disabled')).toBeDefined()

		ui.setSitting('object')
		w = openSelf()
		const row = findRow(w, 'Stand up')
		expect(row.attributes('disabled')).toBeUndefined()
		const spy = vi.fn()
		window.addEventListener('qs:stand-up', spy)
		await row.trigger('click')
		expect(spy).toHaveBeenCalledTimes(1)
		window.removeEventListener('qs:stand-up', spy)
	})

	it('"Sit down" disabled while already seated', () => {
		ui.setSitting('ground')
		const w = openSelf()
		expect(findRow(w, 'Sit down').attributes('disabled')).toBeDefined()
	})
})

describe('AvatarContextMenu — other avatar: Zoom in / Pay / Inspect', () => {
	it('"Zoom in" dispatches qs:zoom-to-object with the avatar\'s localId', async () => {
		const w = openMenu()
		const row = findRow(w, 'Zoom in')
		expect(row).toBeTruthy()
		const spy = vi.fn()
		window.addEventListener('qs:zoom-to-object', spy)
		await row.trigger('click')
		expect(spy).toHaveBeenCalledTimes(1)
		expect(spy.mock.calls[0][0].detail).toEqual({ localId: 7 })
		window.removeEventListener('qs:zoom-to-object', spy)
	})

	it('"Pay" opens PayFloater targeting the avatar', async () => {
		const w = openMenu()
		const row = findRow(w, 'Pay')
		expect(row.attributes('disabled')).toBeUndefined()
		await row.trigger('click')
		expect(ui.payTarget).toEqual({ targetId: 'agent-1', targetName: 'Jane Doe', kind: 'avatar' })
		expect(ui.avatarMenu).toBeNull()
	})

	it('"Inspect" opens the InspectAvatarFloater with the agentId', async () => {
		const w = openMenu()
		const row = findRow(w, 'Inspect')
		expect(row).toBeTruthy()
		await row.trigger('click')
		expect(ui.inspectAvatarId).toBe('agent-1')
		expect(ui.avatarMenu).toBeNull()
	})
})

describe('AvatarContextMenu — other avatar: Invite to group', () => {
	it('row disabled with a tooltip when the self has zero groups', () => {
		social.groups = []
		const w = openMenu()
		const row = findRow(w, 'Invite to group')
		expect(row).toBeTruthy()
		expect(row.attributes('disabled')).toBeDefined()
		expect(row.attributes('title')).toBe("You aren't a member of any groups")
	})

	it('lists self groups by name in a submenu; picking one invites the target + toasts', async () => {
		social.groups = [{ id: 'g1', name: 'Builders Guild' }, { id: 'g2', name: 'Sailors' }]
		const w = openMenu()
		const parent = w.findAll('button').find(b => b.text().includes('Invite to group'))
		expect(parent).toBeTruthy()
		expect(parent.attributes('disabled')).toBeUndefined()
		const groupRow = w.findAll('button').find(b => b.text() === 'Builders Guild')
		expect(groupRow).toBeTruthy()
		await groupRow.trigger('click')
		expect(inviteToGroup).toHaveBeenCalledWith({ groupId: 'g1', inviteeIds: ['agent-1'] })
		expect(ui.avatarMenu).toBeNull()
	})
})
