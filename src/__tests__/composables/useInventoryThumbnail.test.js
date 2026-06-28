// src/__tests__/composables/useInventoryThumbnail.test.js
// Tests for useInventoryThumbnail — caching, concurrency cap, and non-texture skip.
// getTextureUrl is mocked so no real IDB / WS / decoder is exercised here.

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// Drain the microtask queue by resolving a few ticks — needed because our .then() chains
// are two hops deep (semaphore .finally → .then in thumbnailFor).
async function flushMicrotasks() {
	for (let i = 0; i < 5; i++) await Promise.resolve()
}

// --- mock getTextureUrl BEFORE importing the composable ---
// vitest hoists vi.mock() calls, so the module under test picks up the mock.
vi.mock('@/composables/useTextureFetch.js', () => ({
	getTextureUrl: vi.fn(),
}))

import { getTextureUrl } from '@/composables/useTextureFetch.js'
import {
	thumbnailFor,
	useInventoryThumbnail,
	_resetThumbnailCache,
	_thumbSemaphoreState,
} from '@/composables/useInventoryThumbnail.js'

function makeItem(overrides = {}) {
	return {
		assetType: 0,
		assetId:   '11111111-1111-1111-1111-111111111111',
		name:      'Test Texture',
		...overrides,
	}
}

beforeEach(() => {
	vi.resetAllMocks()
	_resetThumbnailCache()
})

afterEach(() => {
	vi.restoreAllMocks()
})

// --- null returns for non-texture items ---

describe('thumbnailFor — non-texture items', () => {
	it('returns a null ref for a non-texture assetType', () => {
		const item = makeItem({ assetType: 7 })   // notecard
		const r = thumbnailFor(item)
		expect(r.value).toBeNull()
		expect(getTextureUrl).not.toHaveBeenCalled()
	})

	it('returns a null ref when item is null', () => {
		const r = thumbnailFor(null)
		expect(r.value).toBeNull()
	})

	it('returns a null ref when assetId is missing', () => {
		const r = thumbnailFor({ assetType: 0 })
		expect(r.value).toBeNull()
	})

	it('does not start a fetch for a non-texture item', () => {
		thumbnailFor(makeItem({ assetType: 3 }))   // sound
		expect(getTextureUrl).not.toHaveBeenCalled()
	})
})

// --- caching behavior ---

describe('thumbnailFor — caching', () => {
	it('resolves to the object URL returned by getTextureUrl', async () => {
		getTextureUrl.mockResolvedValue('blob:http://localhost/abc')
		const item = makeItem()
		const r = thumbnailFor(item)
		// null while promise is in flight
		expect(r.value).toBeNull()
		// flush microtasks
		await flushMicrotasks()
		expect(r.value).toBe('blob:http://localhost/abc')
	})

	it('returns the same ref for two items with the same assetId', () => {
		getTextureUrl.mockResolvedValue('blob:http://localhost/abc')
		const a = makeItem({ assetId: 'aaaa-1111' })
		const b = makeItem({ assetId: 'aaaa-1111' })
		const r1 = thumbnailFor(a)
		const r2 = thumbnailFor(b)
		expect(r1).toBe(r2)
		// getTextureUrl should only be called ONCE for the same UUID
		expect(getTextureUrl).toHaveBeenCalledTimes(1)
	})

	it('returns distinct refs for different assetIds', () => {
		getTextureUrl.mockResolvedValue(null)
		const a = makeItem({ assetId: 'aaaa-0000' })
		const b = makeItem({ assetId: 'bbbb-0000' })
		const r1 = thumbnailFor(a)
		const r2 = thumbnailFor(b)
		expect(r1).not.toBe(r2)
		expect(getTextureUrl).toHaveBeenCalledTimes(2)
	})

	it('stays null when getTextureUrl resolves null (failed / unknown asset)', async () => {
		getTextureUrl.mockResolvedValue(null)
		const r = thumbnailFor(makeItem())
		await flushMicrotasks()
		expect(r.value).toBeNull()
	})

	it('stays null when getTextureUrl rejects', async () => {
		getTextureUrl.mockRejectedValue(new Error('network error'))
		const r = thumbnailFor(makeItem())
		await flushMicrotasks()
		expect(r.value).toBeNull()
	})
})

// --- concurrency cap ---

describe('thumbnailFor — concurrency cap (MAX_THUMB_INFLIGHT = 4)', () => {
	it('starts at most 4 concurrent getTextureUrl calls', async () => {
		// Use unresolved promises to hold slots open.
		let resolvers = []
		getTextureUrl.mockImplementation(() => new Promise(res => { resolvers.push(res) }))

		const ids = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6']
		ids.forEach(id => thumbnailFor(makeItem({ assetId: id })))

		// Yield to allow _thumbPump to start inflight slots.
		await Promise.resolve()

		// Only 4 slots should be in flight; 2 still queued.
		expect(getTextureUrl).toHaveBeenCalledTimes(4)
		expect(_thumbSemaphoreState().inflight).toBe(4)
		expect(_thumbSemaphoreState().queued).toBe(2)

		// Resolve one slot — the next queued item should start.
		resolvers[0]('blob:url-a1')
		await flushMicrotasks()

		expect(getTextureUrl).toHaveBeenCalledTimes(5)
		expect(_thumbSemaphoreState().inflight).toBe(4)
		expect(_thumbSemaphoreState().queued).toBe(1)

		// Resolve the rest.
		for (let i = 1; i < resolvers.length; i++) resolvers[i]('blob:url')
		await flushMicrotasks()
		// 6th item eventually starts after all previous resolve.
		expect(getTextureUrl).toHaveBeenCalledTimes(6)
	})

	it('inflight returns to 0 after all fetches complete', async () => {
		getTextureUrl.mockResolvedValue('blob:done')
		const ids = ['b1', 'b2', 'b3']
		ids.forEach(id => thumbnailFor(makeItem({ assetId: id })))
		await flushMicrotasks()
		expect(_thumbSemaphoreState().inflight).toBe(0)
		expect(_thumbSemaphoreState().queued).toBe(0)
	})
})

// --- composable API surface ---

describe('useInventoryThumbnail', () => {
	it('exports thumbnailFor from the composable factory', () => {
		const { thumbnailFor: fn } = useInventoryThumbnail()
		expect(typeof fn).toBe('function')
	})
})
