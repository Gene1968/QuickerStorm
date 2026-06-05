import { describe, it, expect } from 'bun:test'
import { formatBytes } from '@/utils/formatBytes.js'

describe('formatBytes', () => {
	it('formats bytes below 1 KB', () => {
		expect(formatBytes(0)).toBe('0 B')
		expect(formatBytes(512)).toBe('512 B')
	})

	it('formats KB', () => {
		expect(formatBytes(1024)).toBe('1.0 KB')
		expect(formatBytes(1536)).toBe('1.5 KB')
	})

	it('formats MB', () => {
		expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
		expect(formatBytes(312.4 * 1024 * 1024)).toBe('312.4 MB')
	})

	it('formats GB', () => {
		expect(formatBytes(1.5 * 1024 * 1024 * 1024)).toBe('1.5 GB')
	})
})
