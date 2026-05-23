const LS_KEY = 'ava_client_stats'

function detectBrowser(ua) {
	if (/Edg\//.test(ua))     return 'Edge'
	if (/OPR\/|Opera/.test(ua)) return 'Opera'
	if (/Chrome\//.test(ua))  return 'Chrome'
	if (/Firefox\//.test(ua)) return 'Firefox'
	if (/Safari\//.test(ua))  return 'Safari'
	return 'Other'
}

function detectOS(ua) {
	if (/iPhone/.test(ua))                    return 'iOS'
	if (/iPad/.test(ua))                      return 'iPadOS'
	if (/Android/.test(ua))                   return 'Android'
	if (/Win/.test(ua))                       return 'Windows'
	if (/Mac/.test(ua))                       return 'macOS'
	if (/Linux/.test(ua))                     return 'Linux'
	return 'Other'
}

function isMobileUA(ua) {
	return /iPhone|iPad|Android/i.test(ua)
}

/**
 * Query the GPU renderer string via WEBGL_debug_renderer_info.
 * Chrome/Edge return the real GPU (e.g. "ANGLE (Intel Iris Xe Graphics Direct3D11 vs_5_0 ps_5_0)").
 * Firefox and Safari return generic strings for privacy — treat those as null.
 * Creates a temporary canvas just for the query, then immediately loses the context.
 *
 * VRAM is not accessible via any Web API; the renderer string is the best available proxy
 * (you can infer GPU class from model name). navigator.deviceMemory gives system RAM only.
 */
function detectGPU() {
	try {
		const canvas = document.createElement('canvas')
		const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
		if (!gl) return { gpuVendor: null, gpuRenderer: null }
		const ext = gl.getExtension('WEBGL_debug_renderer_info')
		let vendor = null, renderer = null
		if (ext) {
			vendor   = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)   || null
			renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || null
			// Firefox returns "Mozilla" / "Mozilla -- ANGLE", Safari returns generic strings
			if (vendor === 'Mozilla' || renderer === 'Mozilla') {
				vendor = null; renderer = null
			}
		}
		// Release GPU resources immediately
		const lc = gl.getExtension('WEBGL_lose_context')
		if (lc) lc.loseContext()
		return { gpuVendor: vendor, gpuRenderer: renderer }
	} catch {
		return { gpuVendor: null, gpuRenderer: null }
	}
}

/**
 * Performance tier classification.
 *
 * Tiers:
 *   'low' — antialias off, DPR 1.0, 30 fps cap
 *   'mid' — antialias on,  DPR 1.5, 45 fps cap  (typical office laptop, phone, tablet)
 *   'std' — antialias on,  DPR 2.0, 60 fps      (modern workstation / high-end laptop)
 *
 * Signals used (in priority order):
 *   1. RAM (navigator.deviceMemory — Chrome/Edge only, undefined in Firefox/Safari)
 *   2. CPU core count (navigator.hardwareConcurrency)
 *   3. Mobile UA flag
 *
 * NOTE: hardwareConcurrency reports logical threads (incl. hyperthreading).
 *   2  = single-core HT or dual-core — very old/budget
 *   4  = dual-core HT or quad-core   — mid laptop circa 2015-2020
 *   6  = hexa-core or tri-core HT
 *   8  = quad-core HT or octa-core   — modern mid-range
 *  12+ = high-end desktop or Apple Silicon
 */
function classifyPerfTier(mobile, cores, ramGb) {
	// Low — struggling hardware
	if (mobile && cores !== null && cores < 6)  return 'low'
	if (!mobile && cores !== null && cores <= 2) return 'low'
	if (ramGb !== null && ramGb <= 2)           return 'low'

	// Mid — capable but not high-end
	if (mobile)                                  return 'mid'   // any non-low mobile/tablet
	if (cores !== null && cores <= 6)            return 'mid'   // typical office laptop
	if (ramGb !== null && ramGb <= 4)            return 'mid'   // 4 GB RAM device

	return 'std'
}

function initStats() {
	const stored = (() => {
		try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null') } catch { return null }
	})()

	// Stable per-device ID — survives across logins and sessions
	let deviceId = localStorage.getItem('ava_device_id')
	if (!deviceId) {
		deviceId = crypto.randomUUID()
		localStorage.setItem('ava_device_id', deviceId)
	}

	const ua     = navigator.userAgent || ''
	const mobile = isMobileUA(ua)
	const cores  = navigator.hardwareConcurrency || null
	// deviceMemory: Chrome/Edge only; undefined in Firefox/Safari
	const ramGb  = navigator.deviceMemory ?? null

	const perfTier  = classifyPerfTier(mobile, cores, ramGb)
	const isLowEnd  = perfTier === 'low'
	const isMidRange = perfTier === 'mid'

	// Sticky "ever" flags — once set, stay set across sessions
	const everLowEnd  = isLowEnd  || (stored?.everLowEnd  === true)
	const everMidRange = isMidRange || (stored?.everMidRange === true)

	// Read theme from localStorage (darkmode written by useTheme)
	const savedTheme = localStorage.getItem('darkmode')
	const prefersDark = savedTheme
		? savedTheme === 'dark'
		: window.matchMedia?.('(prefers-color-scheme: dark)').matches

	const nightCount   = (stored?.nightCount || 0) + (prefersDark ? 1 : 0)
	const dayCount     = (stored?.dayCount   || 0) + (prefersDark ? 0 : 1)
	const sessionCount = (stored?.sessionCount || 0) + 1

	const { gpuVendor, gpuRenderer } = detectGPU()

	const browser = detectBrowser(ua)
	const os      = detectOS(ua)

	const stats = {
		deviceId,
		deviceLabel:  `${os} · ${browser}${mobile ? ' · mobile' : ''}`,
		browser,
		os,
		perfTier,
		isLowEnd,
		isMidRange,
		everLowEnd,
		everMidRange,
		nightCount,
		dayCount,
		sessionCount,
		screenW:      window.innerWidth,
		screenH:      window.innerHeight,
		dpr:          Math.round((window.devicePixelRatio || 1) * 10) / 10,
		cores,
		ramGb,
		gpuVendor,
		gpuRenderer,
		mobile,
	}

	try { localStorage.setItem(LS_KEY, JSON.stringify(stats)) } catch { /* ignore */ }

	return stats
}

// Module-level singleton — initialized once at import time
const _stats = initStats()

export function useClientStats() {
	return { clientStats: _stats }
}
