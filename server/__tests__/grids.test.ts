import { describe, it, expect } from 'bun:test'
import { getGrid, getGrids } from '../lib/grids'

describe('grids', () => {
	it('loads all grids', () => {
		const grids = getGrids()
		expect(Object.keys(grids).length).toBeGreaterThan(0)
	})

	it('returns agni grid with correct loginURI', () => {
		const g = getGrid('agni')
		expect(g).toBeDefined()
		expect(g!.loginURI).toContain('agni.lindenlab.com')
	})

	it('returns undefined for unknown grid', () => {
		expect(getGrid('nonexistent')).toBeUndefined()
	})
})
