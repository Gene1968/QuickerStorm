import { describe, it, expect, beforeEach } from 'vitest'
import { useTexDecoder } from '@/composables/useTexDecoder.js'

// jsdom: constructing a module Worker from a file URL throws → exercises the sync fallback. jsdom also
// has no createImageBitmap, so the fallback decodeToPixels resolves null. The contract under test is
// "degrades to null WITHOUT hanging", which is exactly the worker-unavailable path real browsers never hit.
describe('useTexDecoder (fallback)', () => {
	let dec
	beforeEach(() => { dec = useTexDecoder() })

	it('resolves null (does not hang) when the worker is unavailable and decode cannot run', async () => {
		const out = await dec.decode(new Blob(['x']), 256)
		expect(out).toBeNull()
		dec.dispose()
	})

	it('settles the decode promise when dispose() is called mid-flight (no hang)', async () => {
		const p = dec.decode(new Blob(['x']), 256)
		dec.dispose()
		const out = await p
		expect(out).toBeNull()
	})

	it('reports outstanding() as 0 after a fallback decode resolves', async () => {
		await dec.decode(new Blob(['x']), 256)
		expect(dec.outstanding()).toBe(0)
	})

	it('takeStats() returns a job count and resets it', async () => {
		await dec.decode(new Blob(['x']), 256)
		const s = dec.takeStats()
		expect(s.jobs).toBe(1)
		expect(dec.takeStats().jobs).toBe(0)
		dec.dispose()
	})
})
