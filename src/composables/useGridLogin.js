// src/composables/useGridLogin.js — orchestrates login: WS connect → LOGIN message → handle response
import { useRealtimeSocket } from './useRealtimeSocket'
import { useGridStore } from '@/stores/gridStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useRouter } from 'vue-router'
import { S, C } from '@shared/protocol.js'

export function useGridLogin() {
	const { connect, on, off, emit, connected } = useRealtimeSocket()
	const gridStore    = useGridStore()
	const sessionStore = useSessionStore()
	const router       = useRouter()

	async function login(username, password) {
		gridStore.setLoginState('loading')

		connect()  // idempotent — no-op if already connected

		// If not yet connected, wait for the _open event
		if (!connected.value) {
			await new Promise((resolve, reject) => {
				const timeout = setTimeout(() => {
					off('_open', onOpen)
					reject(new Error('WS connect timeout'))
				}, 10_000)

				function onOpen() {
					clearTimeout(timeout)
					off('_open', onOpen)
					resolve()
				}

				on('_open', onOpen)
			})
		}

		// Send login — Bun proxies XML-RPC to grid
		emit(C.LOGIN, {
			grid:     gridStore.selectedNick,
			username,
			password,
		})

		return new Promise((resolve, reject) => {
			function onOk(d) {
				off(S.LOGIN_OK,   onOk)
				off(S.LOGIN_FAIL, onFail)
				sessionStore.setSession(d)
				gridStore.setLoginState('connected')
				router.push('/world')
				resolve(d)
			}
			function onFail(d) {
				off(S.LOGIN_OK,   onOk)
				off(S.LOGIN_FAIL, onFail)
				gridStore.setLoginState('error', d.message)
				reject(new Error(d.message))
			}
			on(S.LOGIN_OK,   onOk)
			on(S.LOGIN_FAIL, onFail)
		})
	}

	return { login }
}
