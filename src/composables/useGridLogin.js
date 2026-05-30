// src/composables/useGridLogin.js — orchestrates login: WS connect → LOGIN message → handle response
import { useRealtimeSocket } from './useRealtimeSocket'
import { useGridStore } from '@/stores/gridStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useInventoryStore } from '@/stores/inventoryStore'
import { useRouter } from 'vue-router'
import { S, C } from '@shared/protocol.js'

const LOGIN_TIMEOUT_MS = 30_000   // 30s total for XML-RPC round-trip + circuit setup
const WS_CONNECT_MS    = 10_000   // 10s to get WS open

export function useGridLogin() {
	const { connect, on, off, emit, connected } = useRealtimeSocket()
	const gridStore     = useGridStore()
	const sessionStore  = useSessionStore()
	const inventoryStore = useInventoryStore()
	const router        = useRouter()

	// WHY: Ask server whether a live circuit exists for this user WITHOUT triggering login.
	// Returns true if the server still holds the circuit (within 15s hold window after WS drop).
	// LandingView calls this before auto-reconnect so it never forces a fresh XML-RPC login
	// when the circuit has already expired (e.g. user was away >15s, or Firestorm took over).
	async function checkCircuit(grid, username) {
		connect()  // idempotent

		if (!connected.value) {
			try {
				await new Promise((resolve, reject) => {
					const timeout = setTimeout(() => { off('_open', onOpen); reject() }, WS_CONNECT_MS)
					function onOpen() { clearTimeout(timeout); off('_open', onOpen); resolve() }
					on('_open', onOpen)
				})
			} catch {
				return false  // can't reach server → treat as not alive
			}
		}

		emit(C.CHECK_CIRCUIT, { grid, username })

		return new Promise((resolve) => {
			const timeout = setTimeout(() => {
				off(S.CIRCUIT_STATUS, onStatus)
				resolve(false)  // no response in 5s → treat as not alive
			}, 5_000)

			function onStatus(d) {
				clearTimeout(timeout)
				off(S.CIRCUIT_STATUS, onStatus)
				resolve(!!d?.alive)
			}
			on(S.CIRCUIT_STATUS, onStatus)
		})
	}

	async function login(username, password, destination = 'last') {
		gridStore.setLoginState('loading')

		connect()  // idempotent — no-op if already connected

		// Wait for WS open if not yet connected
		if (!connected.value) {
			try {
				await new Promise((resolve, reject) => {
					const timeout = setTimeout(() => {
						off('_open', onOpen)
						reject(new Error('Could not reach quickerSTORM server — is it running?'))
					}, WS_CONNECT_MS)

					function onOpen() {
						clearTimeout(timeout)
						off('_open', onOpen)
						resolve()
					}
					on('_open', onOpen)
				})
			} catch (err) {
				gridStore.setLoginState('error', err.message)
				throw err
			}
		}

		// Send login — Bun proxies XML-RPC to grid
		emit(C.LOGIN, {
			grid:        gridStore.selectedNick,
			username,
			password,
			destination,  // 'last', 'home', or 'uri:RegionName&x&y&z'
		})

		// Wait for LOGIN_OK or LOGIN_FAIL with timeout
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				off(S.LOGIN_OK,   onOk)
				off(S.LOGIN_FAIL, onFail)
				gridStore.setLoginState('error', 'Login timed out — grid may be unreachable')
				reject(new Error('Login timed out — grid may be unreachable'))
			}, LOGIN_TIMEOUT_MS)

			function onOk(d) {
				clearTimeout(timeout)
				off(S.LOGIN_OK,   onOk)
				off(S.LOGIN_FAIL, onFail)
				sessionStore.setSession({ ...d, username })
				// WHY: folder skeleton ships in LOGIN_OK (fresh + resume) — populate the tree now.
				inventoryStore.loadFromLogin(d)
				gridStore.setLoginState('connected')
				router.push('/world')
				resolve(d)
			}
			function onFail(d) {
				clearTimeout(timeout)
				off(S.LOGIN_OK,   onOk)
				off(S.LOGIN_FAIL, onFail)
				gridStore.setLoginState('error', d?.message ?? 'Login failed')
				reject(new Error(d?.message ?? 'Login failed'))
			}
			on(S.LOGIN_OK,   onOk)
			on(S.LOGIN_FAIL, onFail)
		})
	}

	return { login, checkCircuit }
}
