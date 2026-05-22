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
			exclude: [...configDefaults.exclude, 'e2e/*'],
			root: fileURLToPath(new URL('./', import.meta.url)),
		},
	})
)
