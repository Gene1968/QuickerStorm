import { fileURLToPath, URL } from "node:url"

import { defineConfig, loadEnv } from "vite"
import path from "path"
import vue from "@vitejs/plugin-vue"

// renaming the index as plugin
const renameIndexPlugin = (newFilename) => {
	return {
		name: "renameIndex",
		enforce: "post",
		generateBundle (options, bundle) {
			const indexHtml = bundle["index.html"]
			if (!newFilename) indexHtml.fileName = "index.html"
			else indexHtml.fileName = newFilename
		},
	}
}

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

	const plugins = [vue()]
	console.log("Mode: ", mode)
	// SharePoint hosting expects index.aspx; standalone hosting (Railway/staging) keeps index.html.
	const isSharePointHost = mode === "im" || mode === "production"
	if (mode !== "development") {
		if (isSharePointHost) plugins.push(renameIndexPlugin("index.aspx"))
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
		outDir = path.join(__dirname, "dist/usaf")
	}

	return defineConfig({
		server: {
			host: '0.0.0.0',
			port: 5173,
			strictPort: false, // bump to next available port if 5173 is in use
			proxy: {
				// Proxy Slack API calls to avoid CORS in dev.
				// SlackApi.js uses /slack-api/ as base when running on localhost.
				'/slack-api': {
					target: 'https://slack.com/api',
					changeOrigin: true,
					rewrite: (p) => p.replace(/^\/slack-api/, ''),
					secure: true,
				},
			},
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
		// SP hosting needs the asset path prefix (/quickerSTORM/SiteAssets/);
		// standalone hosting (Railway) serves from root.
		// eslint-disable-next-line no-undef
		base: isSharePointHost ? process.env.VITE_PATH : '/',
	})
}
