// src/composables/useCaps.js — single front door for HTTP capability calls.
// cap('Name').post(params) → C.CAP_CALL → server invokeCap → S.CAP_RESULT → resolves the Promise.
// URLs + LLSD stay server-side; the client speaks cap NAME + plain JSON. One line wires a new cap.
import { onMounted, onUnmounted } from 'vue'
import { useRealtimeSocket } from './useRealtimeSocket'
import { C, S } from '@shared/protocol.js'

const TIMEOUT_MS = 30_000
const pending = new Map()    // id → { resolve, reject, timer }
let registered = false
let seq = 0

function nextId() { return `cap_${++seq}_${Date.now()}` }

function onCapResult(d) {
	const p = pending.get(d?.id)
	if (!p) return
	clearTimeout(p.timer)
	pending.delete(d.id)
	if (d.ok) p.resolve(d.result)
	else p.reject(new Error(d.error || 'cap_failed'))
}

export function useCaps() {
	const { on, off, emit } = useRealtimeSocket()

	function call(capName, params, method) {
		const id = nextId()
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				pending.delete(id)
				reject(new Error('cap_timeout'))
			}, TIMEOUT_MS)
			pending.set(id, { resolve, reject, timer })
			emit(C.CAP_CALL, { id, cap: capName, params, method })
		})
	}

	// cap('Name').post({...}) / .get({...})
	function cap(capName) {
		return {
			post: (params) => call(capName, params, 'POST'),
			get:  (params) => call(capName, params, 'GET'),
		}
	}

	onMounted(() => {
		if (!registered) { on(S.CAP_RESULT, onCapResult); registered = true }
	})
	onUnmounted(() => {
		if (registered) { off(S.CAP_RESULT, onCapResult); registered = false }
		for (const [, p] of pending) { clearTimeout(p.timer); p.reject(new Error('unmounted')) }
		pending.clear()
	})

	return { cap }
}
