// src/composables/use2DFallback.js — detect low-end/mobile; expose mode toggle
import { ref, onMounted } from 'vue'

const is2D = ref(false)

export function use2DFallback() {
	function detect() {
		const mobile = /Mobi|Android/i.test(navigator.userAgent)
		const lowMem = navigator.deviceMemory !== undefined && navigator.deviceMemory < 2
		const noGL   = (() => {
			try {
				const c = document.createElement('canvas')
				return !c.getContext('webgl2') && !c.getContext('webgl')
			} catch { return true }
		})()
		is2D.value = mobile || lowMem || noGL
	}

	onMounted(detect)

	function setMode(mode) { is2D.value = mode === '2d' }

	return { is2D, setMode }
}
