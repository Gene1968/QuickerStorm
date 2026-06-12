import { fileURLToPath, URL } from "node:url"

import { defineConfig, loadEnv } from "vite"
import path from "path"
import vue from "@vitejs/plugin-vue"

// main config export
export default ({ mode }) => {
	// eslint-disable-next-line no-undef
	process.env = { ...process.env, ...loadEnv(mode, process.cwd()) }

	const buildTime = new Date().toISOString()

	// Writes version.json to dist so the running app can detect new deployments
	const versionPlugin = {
		name: 'version-json',
		generateBundle () {
			this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ v: buildTime }) })
		},
	}

	const plugins = [vue({
		template: {
			compilerOptions: {
				// WHY: emoji-picker is a web component (emoji-picker-element package),
				// not a Vue component — suppress "Failed to resolve component" warning.
				isCustomElement: (tag) => tag === 'emoji-picker',
			},
		},
	})]
	console.log("Mode: ", mode)
	if (mode !== "development") {
		plugins.push(versionPlugin)
	}

	// Output folder per deploy target.
	let outDir
	// eslint-disable-next-line no-undef
	const env = process.env.VITE_APP_ENV
	if (env === "im") {
		// eslint-disable-next-line no-undef
		outDir = path.join(__dirname, "dist/im")
	} else if (env === "staging") {
		// eslint-disable-next-line no-undef
		outDir = path.join(__dirname, "dist/staging")
	} else {
		// eslint-disable-next-line no-undef
		outDir = path.join(__dirname, "dist/prod")
	}

	return defineConfig({
		server: {
			host: '0.0.0.0',
			port: 5173,
			strictPort: false, // bump to next available port if 5173 is in use
		},
		plugins: plugins,
		assetsInclude: ['**/*.mp4', '**/*.pdf'],
		// css: {
		// 	preprocessorOptions: {
		// 		scss: {
		// 			additionalData: `@import "@/assets/_global.scss";`,
		// 		},
		// 	},
		// },
		resolve: {
			alias: {
				'@': fileURLToPath(new URL('./src', import.meta.url)),
				'@shared': fileURLToPath(new URL('./shared', import.meta.url)),
			},
		},
		define: {
			__BUILD_TIME__: JSON.stringify(buildTime),
		},
		build: {
			outDir: outDir,
		},
		// this removes the console
		// esbuild: {
		//   drop: ['console', 'debugger']
		// },
		// eslint-disable-next-line no-undef
		base: '/',
	})
}
