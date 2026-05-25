import { vi, describe, it, expect, beforeEach } from 'vitest'

// Stub Audio + AudioContext before module loads
globalThis.Audio = vi.fn(() => ({ play: vi.fn().mockResolvedValue(), volume: 1 }))
globalThis.AudioContext = vi.fn(() => ({ resume: vi.fn().mockResolvedValue(), currentTime: 0 }))
globalThis.window = { AudioContext: globalThis.AudioContext }

const { useAudio, isAllAudioMuted, toggleAllAudioMute } =
  await import('@/composables/useAudio.js')

describe('useAudio — channel volumes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('exports masterVolume defaulting to 1', () => {
    const { masterVolume } = useAudio()
    expect(masterVolume.value).toBe(1)
  })

  it('exports interfaceVolume defaulting to 1', () => {
    const { interfaceVolume } = useAudio()
    expect(interfaceVolume.value).toBe(1)
  })

  it('exports interfaceMuted defaulting to false', () => {
    const { interfaceMuted } = useAudio()
    expect(interfaceMuted.value).toBe(false)
  })

  it('isAllAudioMuted defaults to false (no localStorage)', () => {
    expect(isAllAudioMuted.value).toBe(false)
  })

  it('toggleAllAudioMute flips isAllAudioMuted', () => {
    const before = isAllAudioMuted.value
    toggleAllAudioMute()
    expect(isAllAudioMuted.value).toBe(!before)
    toggleAllAudioMute() // restore
  })
})
