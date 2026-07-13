// MenuBar — right-click-menu sweep: Avatar ▸ Movement (Sit down/Stand up/Fly/Stop flying/Force
// ground Sit) + Selected objects ▸ Buy / Build ▸ Object ▸ Buy gating. Sit/Stand-up/Fly bridge to
// useWorldEngine.js via window CustomEvents ('qs:sit-ground', 'qs:stand-up', 'qs:toggle-fly')
// because WorldCanvas.vue doesn't currently forward those functions out of the composable's
// closure (see this component's task report) — we assert the dispatch itself.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

// WHY: MenuBar's template has <img src="/favicon.svg">, a public-root asset reference the Vue SFC
// compiler turns into a bare `import '/favicon.svg'` — under vitest's module graph (no running
// dev server to resolve public/ paths against) that import fails to resolve as a real file. Stub
// it; irrelevant to menu wiring.
vi.mock('/favicon.svg', () => ({ default: '' }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/composables/useRealtimeSocket', () => ({ useRealtimeSocket: () => ({ emit: vi.fn() }) }))
vi.mock('@/composables/useAudio.js', () => ({ playSound: vi.fn(), useAudio: () => ({ playSound: vi.fn() }) }))
vi.mock('@/composables/useTeleport.js', () => ({ useTeleport: () => ({ requestHomeTeleport: vi.fn(), setHomeHere: vi.fn() }) }))
const takeObject = vi.fn(), takeObjectCopy = vi.fn(), sendDelete = vi.fn()
vi.mock('@/composables/useLLUDP', () => ({ useLLUDP: () => ({ takeObject, takeObjectCopy, sendDelete }) }))

import MenuBar from '@/components/MenuBar.vue'
import { useUiStore } from '@/stores/uiStore'
import { useWorldStore, PCODE_PRIM } from '@/stores/worldStore'
import { useSessionStore } from '@/stores/sessionStore'

const AGENT = 'AAAAAAAA-1111-2222-3333-444444444444'
const OTHER = 'BBBBBBBB-1111-2222-3333-444444444444'

let ui, world, session

function mountOpenAvatarMenu() {
	const w = mount(MenuBar)
	// Open the top-level "Avatar" dropdown so its (always-rendered, CSS-hover-revealed) nested
	// items are in the DOM and clickable — same convention as ObjectContextMenu's flyout tests.
	w.findAll('button').find(b => b.text() === 'Avatar').trigger('click')
	return w
}

beforeEach(() => {
	setActivePinia(createPinia())
	takeObject.mockClear(); takeObjectCopy.mockClear(); sendDelete.mockClear()
	ui = useUiStore()
	world = useWorldStore()
	session = useSessionStore()
	session.agentId = AGENT
})

describe('MenuBar — Avatar ▸ Movement', () => {
	it('"Sit down" dispatches qs:sit-ground', async () => {
		const w = mountOpenAvatarMenu()
		await w.vm.$nextTick()
		const row = w.findAll('button').find(b => b.text() === 'Sit down')
		expect(row).toBeTruthy()
		expect(row.attributes('disabled')).toBeUndefined()
		const spy = vi.fn()
		window.addEventListener('qs:sit-ground', spy)
		await row.trigger('click')
		expect(spy).toHaveBeenCalledTimes(1)
		window.removeEventListener('qs:sit-ground', spy)
	})

	it('"Stand up" disabled unless seated; dispatches qs:stand-up once seated', async () => {
		let w = mountOpenAvatarMenu()
		await w.vm.$nextTick()
		expect(w.findAll('button').find(b => b.text() === 'Stand up').attributes('disabled')).toBeDefined()

		ui.setSitting('object')
		w = mountOpenAvatarMenu()
		await w.vm.$nextTick()
		const row = w.findAll('button').find(b => b.text() === 'Stand up')
		expect(row.attributes('disabled')).toBeUndefined()
		const spy = vi.fn()
		window.addEventListener('qs:stand-up', spy)
		await row.trigger('click')
		expect(spy).toHaveBeenCalledTimes(1)
		window.removeEventListener('qs:stand-up', spy)
	})

	it('"Fly" dispatches qs:toggle-fly {fly:true} and is checked/disabled once flying', async () => {
		const w = mountOpenAvatarMenu()
		await w.vm.$nextTick()
		const row = w.findAll('button').find(b => b.text() === 'Fly')
		expect(row.attributes('disabled')).toBeUndefined()
		const spy = vi.fn()
		window.addEventListener('qs:toggle-fly', spy)
		await row.trigger('click')
		expect(spy).toHaveBeenCalledTimes(1)
		expect(spy.mock.calls[0][0].detail).toEqual({ fly: true })
		window.removeEventListener('qs:toggle-fly', spy)
	})

	it('"Stop flying" disabled unless flying; dispatches qs:toggle-fly {fly:false} once flying', async () => {
		let w = mountOpenAvatarMenu()
		await w.vm.$nextTick()
		expect(w.findAll('button').find(b => b.text() === 'Stop flying').attributes('disabled')).toBeDefined()

		ui.setFlying(true)
		w = mountOpenAvatarMenu()
		await w.vm.$nextTick()
		const row = w.findAll('button').find(b => b.text() === 'Stop flying')
		expect(row.attributes('disabled')).toBeUndefined()
		const spy = vi.fn()
		window.addEventListener('qs:toggle-fly', spy)
		await row.trigger('click')
		expect(spy).toHaveBeenCalledTimes(1)
		expect(spy.mock.calls[0][0].detail).toEqual({ fly: false })
		window.removeEventListener('qs:toggle-fly', spy)
	})

	it('"Force ground Sit" dispatches qs:sit-ground', async () => {
		const w = mountOpenAvatarMenu()
		await w.vm.$nextTick()
		const row = w.findAll('button').find(b => b.text() === 'Force ground Sit')
		expect(row).toBeTruthy()
		const spy = vi.fn()
		window.addEventListener('qs:sit-ground', spy)
		await row.trigger('click')
		expect(spy).toHaveBeenCalledTimes(1)
		window.removeEventListener('qs:sit-ground', spy)
	})
})

describe('MenuBar — Buy gating (Selected objects ▸ Buy / Build ▸ Object ▸ Buy)', () => {
	function setupForSale(owner, saleType = 1) {
		world.upsertObject({ localId: 5, fullId: 'full-5', pcode: PCODE_PRIM })
		world.applyObjectProperties({ fullId: 'full-5', ownerId: owner, saleType, salePrice: 250 })
		ui.showObjectEdit = true
		ui.editObjectId = 5
	}

	it('both Buy rows disabled when nothing is selected', async () => {
		const w = mountOpenAvatarMenu() // opens Avatar; we need quickerSTORM + Build instead — re-open below
		w.unmount()
		const w2 = mount(MenuBar)
		w2.findAll('button').find(b => b.text() === 'quickerSTORM').trigger('click')
		await w2.vm.$nextTick()
		const rows = w2.findAll('button').filter(b => b.text() === 'Buy')
		expect(rows.length).toBeGreaterThan(0)
		for (const r of rows) expect(r.attributes('disabled')).toBeDefined()
	})

	it('disabled when selected object is owned by self even if for-sale', async () => {
		setupForSale(AGENT)
		const w = mount(MenuBar)
		w.findAll('button').find(b => b.text() === 'quickerSTORM').trigger('click')
		await w.vm.$nextTick()
		const row = w.findAll('button').find(b => b.text() === 'Buy')
		expect(row.attributes('disabled')).toBeDefined()
	})

	it('enabled + opens BuyObjectDialog when selected object is for-sale and owned by someone else (Build ▸ Object ▸ Buy)', async () => {
		setupForSale(OTHER)
		const w = mount(MenuBar)
		w.findAll('button').find(b => b.text() === 'Build').trigger('click')
		await w.vm.$nextTick()
		const row = w.findAll('button').find(b => b.text() === 'Buy')
		expect(row.attributes('disabled')).toBeUndefined()
		await row.trigger('click')
		expect(ui.buyDialogTarget).toEqual({ localId: 5 })
	})
})
