import { describe, it, expect } from 'bun:test'
import { meshDbConfig } from '@/lib/meshCache.js'

describe('meshCache', () => {
	it('exposes a stable store name + key path', () => {
		expect(meshDbConfig.store).toBe('mesh')
		expect(meshDbConfig.keyPath).toBe('uuid')
	})
})
