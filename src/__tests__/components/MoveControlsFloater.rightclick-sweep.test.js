// StandStopFlying — FS LLPanelStandStopFlying parity (llmoveview.cpp:569-589): a STANDALONE
// bottom-center panel, independent of the Movement floater (which in FS only temporarily
// reparents the singleton while open — llmoveview.cpp:157-182). One mode at a time: Stand wins
// while seated (object OR ground — llvoavatar.cpp:8961-8967 sitDown fires for both), Stop Flying
// shows while flying and re-asserts after standing if still airborne (llmoveview.cpp:256-260).
// The MoveControlsFloater rows this file previously tested were replaced by this panel 2026-07-13.
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import StandStopFlying from '@/components/StandStopFlying.vue'
import { useUiStore } from '@/stores/uiStore'

let ui

beforeEach(() => {
	setActivePinia(createPinia())
	ui = useUiStore()
})

function btn(w, text) { return w.findAll('button').find(b => b.text() === text) }

describe('StandStopFlying panel', () => {
	it('renders nothing while standing and not flying', () => {
		const w = mount(StandStopFlying)
		expect(w.findAll('button').length).toBe(0)
	})

	it('"Stand" renders while object-seated and dispatches qs:stand-up', async () => {
		ui.setSitting('object')
		const w = mount(StandStopFlying)
		const b = btn(w, 'Stand')
		expect(b).toBeTruthy()
		let fired = 0
		const spy = () => { fired++ }
		window.addEventListener('qs:stand-up', spy)
		await b.trigger('click')
		expect(fired).toBe(1)
		window.removeEventListener('qs:stand-up', spy)
	})

	it('"Stand" also renders for a GROUND sit (FS sitDown fires for both sit kinds)', () => {
		ui.setSitting('ground')
		const w = mount(StandStopFlying)
		expect(btn(w, 'Stand')).toBeTruthy()
	})

	it('"Stop Flying" renders while flying and dispatches qs:toggle-fly {fly:false}', async () => {
		ui.setFlying(true)
		const w = mount(StandStopFlying)
		const b = btn(w, 'Stop Flying')
		expect(b).toBeTruthy()
		let detail = null
		const spy = (e) => { detail = e.detail }
		window.addEventListener('qs:toggle-fly', spy)
		await b.trigger('click')
		expect(detail).toEqual({ fly: false })
		window.removeEventListener('qs:toggle-fly', spy)
	})

	it('Stand takes precedence over Stop Flying while seated AND flying (FS SSFM one-mode-at-a-time)', () => {
		ui.setSitting('object')
		ui.setFlying(true)
		const w = mount(StandStopFlying)
		expect(btn(w, 'Stand')).toBeTruthy()
		expect(btn(w, 'Stop Flying')).toBeFalsy()
	})
})
