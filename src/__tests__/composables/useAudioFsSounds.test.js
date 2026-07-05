// S-7 (FS UI sound name mapping) + S-8 (sounds-channel gain routing) tests.
// Web Audio is interface-faked: a stub AudioContext with recordable GainNodes.
import { vi, describe, it, expect } from 'vitest'
import { nextTick } from 'vue'

// Stub Audio + AudioContext before the module loads (same pattern as useAudioChannels.test.js).
function fakeGain() {
	return { connect: vi.fn(), disconnect: vi.fn(), gain: { value: 1 } }
}
const fakeCtx = {
	resume: vi.fn().mockResolvedValue(),
	currentTime: 0,
	destination: {},
	createGain: vi.fn(() => fakeGain()),
}
globalThis.Audio = vi.fn(() => ({ play: vi.fn().mockResolvedValue(), volume: 1 }))
// Plain function (not vi.fn arrow): the module calls `new AudioContext()` and a constructor
// returning an object yields that object.
window.AudioContext = function AudioContextStub() { return fakeCtx }

const {
	resolveSoundFile, FS_UI_SOUND_MAP, fsUiSounds,
	busGainValues, getSoundsBus,
	soundsVolume, soundsMuted, masterVolume, isAllAudioMuted,
} = await import('@/composables/useAudio.js')

// The same OGGs the module globs — verifies every mapped FS target actually exists on disk.
const fsOggs = import.meta.glob('../../assets/audio/sl-fs/*.ogg', { eager: true, query: '?url', import: 'default' })
const fsOggNames = new Set(Object.keys(fsOggs).map(k => k.split('/').pop()))

describe('S-7 — FS UI sound name mapping', () => {
	it('maps known cues into sl-fs/ when FS mode is on', () => {
		expect(resolveSoundFile('tick.mp3', true)).toBe('sl-fs/click.ogg')
		expect(resolveSoundFile('woosh.mp3', true)).toBe('sl-fs/teleport.ogg')
		expect(resolveSoundFile('pop.mp3', true)).toBe('sl-fs/window open.ogg')
		expect(resolveSoundFile('chime.mp3', true)).toBe('sl-fs/instant message notification.ogg')
		expect(resolveSoundFile('typing.mp3', true)).toBe('sl-fs/keyboard loop.ogg')
	})

	it('leaves filenames untouched when FS mode is off', () => {
		expect(resolveSoundFile('tick.mp3', false)).toBe('tick.mp3')
		expect(resolveSoundFile('woosh.mp3', false)).toBe('woosh.mp3')
	})

	it('leaves unmapped filenames untouched even in FS mode', () => {
		expect(resolveSoundFile('dooropen.mp3', true)).toBe('dooropen.mp3')
	})

	it('every mapped FS target OGG exists in assets/audio/sl-fs/', () => {
		for (const target of Object.values(FS_UI_SOUND_MAP)) {
			expect(fsOggNames.has(target), `missing sl-fs OGG: ${target}`).toBe(true)
		}
	})

	it('fsUiSounds preference defaults to OFF (current sounds)', () => {
		expect(fsUiSounds.value).toBe(false)
	})
})

describe('S-8 — sounds-channel gain routing math (busGainValues)', () => {
	it('passes volumes through when nothing is muted', () => {
		expect(busGainValues({ allMuted: false, master: 0.7, soundsMuted: false, sounds: 0.4 }))
			.toEqual({ master: 0.7, sounds: 0.4 })
	})
	it('all-muted zeroes the master leg only', () => {
		expect(busGainValues({ allMuted: true, master: 0.7, soundsMuted: false, sounds: 0.4 }))
			.toEqual({ master: 0, sounds: 0.4 })
	})
	it('sounds-muted zeroes the sounds leg only', () => {
		expect(busGainValues({ allMuted: false, master: 0.7, soundsMuted: true, sounds: 0.4 }))
			.toEqual({ master: 0.7, sounds: 0 })
	})
	it('clamps out-of-range volumes', () => {
		expect(busGainValues({ allMuted: false, master: 1.5, soundsMuted: false, sounds: -1 }))
			.toEqual({ master: 1, sounds: 0 })
	})
})

describe('S-8 — live bus wiring (fake AudioContext)', () => {
	it('bus is null before the AudioContext is unlocked', () => {
		expect(getSoundsBus()).toBeNull()
	})

	it('unlock → bus chain soundsGain → masterGain → destination, reactive to channel refs', async () => {
		// First user gesture unlocks the (stubbed) AudioContext.
		document.dispatchEvent(new Event('click'))
		const bus = getSoundsBus()
		expect(bus).not.toBeNull()
		expect(bus.ctx).toBe(fakeCtx)

		// Two gains created: master (→ destination) then sounds (→ master).
		const masterNode = fakeCtx.createGain.mock.results[0].value
		const soundsNode = fakeCtx.createGain.mock.results[1].value
		expect(bus.input).toBe(soundsNode)
		expect(masterNode.connect).toHaveBeenCalledWith(fakeCtx.destination)
		expect(soundsNode.connect).toHaveBeenCalledWith(masterNode)

		// Slider moves are audible: watchers push new values into the GainNodes.
		soundsVolume.value = 0.25
		await nextTick()
		expect(soundsNode.gain.value).toBe(0.25)

		soundsMuted.value = true
		await nextTick()
		expect(soundsNode.gain.value).toBe(0)
		soundsMuted.value = false
		await nextTick()
		expect(soundsNode.gain.value).toBe(0.25)

		masterVolume.value = 0.5
		await nextTick()
		expect(masterNode.gain.value).toBe(0.5)

		isAllAudioMuted.value = true
		await nextTick()
		expect(masterNode.gain.value).toBe(0)
	})
})
