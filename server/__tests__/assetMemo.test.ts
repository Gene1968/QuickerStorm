import { describe, it, expect } from 'bun:test'
import { createAssetMemo } from '../lib/assetMemo'

const memo = (budget: number) => createAssetMemo<number>({ budgetBytes: budget, sizeOf: (v) => v })

describe('createAssetMemo', () => {
	it('caches successful results — second call does not re-run work', async () => {
		const m = memo(100)
		let runs = 0
		const work = async () => { runs++; return 40 }
		expect(await m.memo('a', work)).toBe(40)
		expect(await m.memo('a', work)).toBe(40)
		expect(runs).toBe(1)
	})

	it('coalesces concurrent requests for the same key into one work() run', async () => {
		const m = memo(100)
		let runs = 0
		let release!: (v: number) => void
		const work = () => { runs++; return new Promise<number>(r => { release = r }) }
		const p1 = m.memo('a', work)
		const p2 = m.memo('a', work)
		release(40)
		expect(await p1).toBe(40)
		expect(await p2).toBe(40)
		expect(runs).toBe(1)
	})

	it('does not cache null (errors) — next call retries', async () => {
		const m = memo(100)
		let runs = 0
		expect(await m.memo('a', async () => { runs++; return null })).toBeNull()
		expect(await m.memo('a', async () => { runs++; return 40 })).toBe(40)
		expect(runs).toBe(2)
	})

	it('evicts least-recently-used entries past the byte budget', async () => {
		const m = memo(100)
		await m.memo('a', async () => 60)
		await m.memo('b', async () => 60)        // over 100 → evict 'a'
		let runs = 0
		await m.memo('b', async () => { runs++; return 60 })
		expect(runs).toBe(0)                     // 'b' still cached
		await m.memo('a', async () => { runs++; return 60 })
		expect(runs).toBe(1)                     // 'a' was evicted → re-fetched
	})

	it('reports stats', async () => {
		const m = memo(100)
		await m.memo('a', async () => 30)
		await m.memo('a', async () => 30)
		const s = m.stats()
		expect(s.size).toBe(1)
		expect(s.bytes).toBe(30)
		expect(s.hits).toBe(1)
		expect(s.misses).toBe(1)
	})
})
