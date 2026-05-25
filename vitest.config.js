import { fileURLToPath, URL } from 'node:url'
import { mergeConfig, defineConfig, configDefaults } from 'vitest/config'
import viteConfigFn from './vite.config'

// vite.config.js exports a function ({ mode }) => defineConfig(...)
// Resolve it to a plain config object so mergeConfig works correctly.
const resolvedViteConfig = typeof viteConfigFn === 'function'
	? viteConfigFn({ mode: 'test' })
	: viteConfigFn

export default mergeConfig(
	resolvedViteConfig,
	defineConfig({
		resolve: {
			alias: {
				'@': fileURLToPath(new URL('./src', import.meta.url)),
				'@shared': fileURLToPath(new URL('./shared', import.meta.url)),
			},
		},
		test: {
			environment: 'jsdom',
			// WHY: server/__tests__ use bun:test — run with `bun test` instead.
			// tests/server/ uses vitest (no bun runtime dependency).
			include: ['src/**/*.{test,spec}.{js,ts}', 'tests/server/**/*.{test,spec}.ts'],
			exclude: [...configDefaults.exclude, 'e2e/*', 'server/**'],
			root: fileURLToPath(new URL('./', import.meta.url)),
		},
	})
)
