/**

* This is outdated from old app "room" concept may now make more sense as "region" or "nearby". Removed door, knock, admit.

* useProximityVoice — WebRTC proximity-based audio.
 *
 * Architecture:
 *   • Each client connects to a simple signaling server (WebSocket).
 *   • Peers in the same room negotiate WebRTC PeerConnections.
 *   • Audio volume is attenuated by spatial distance from the local user.
 *   • Space-to-talk (PTT) mode: hold SPACE to transmit.
 *
 * Signaling server setup:
 *   A lightweight Node.js/WS server is needed (not included here).
 *   The server routes offers/answers/ICE candidates by roomId + userId.
 *
 *   For a quick self-hosted option: https://github.com/peers/peerjs-server
 *   Then set VITE_PEER_SERVER_HOST + VITE_PEER_SERVER_PORT and use PeerJS.
 */
import { ref, watch, onUnmounted } from 'vue'
import { useAudio, isAllAudioMuted } from '@/composables/useAudio.js'
import { useRealtimeSocket } from '@/composables/useRealtimeSocket.js'
import { usePresenceStore } from '@/stores/presenceStore.js'

// ── Module-level mute sync ────────────────────────────────────────────
// Must live here (not inside the composable) so it stays alive as long as
// the module is loaded, regardless of which component called useProximityVoice().
watch(isAllAudioMuted, (muted) => {
	for (const peer of peers.values()) {
		if (!peer.audioEl) continue
		const d = peer._lastDist
		const base = d === undefined ? 1 : Math.max(0, 1 - d / 12)
		peer.audioEl.volume = muted ? 0 : base
	}
})

// Per-tab random suffix so the same SP user on two devices gets unique signaling IDs.
// Stable for the lifetime of the tab (not persisted).
const voiceSessionId = Math.random().toString(36).slice(2, 9)

// ── Audio context (VAD only) + peer state ────────────────────────────
let audioCtx = null
const peers = new Map()   // signalingId → { pc, stream, audioEl }

// Translate signalingId ("42_abc1234") → real presenceUserId ("42") for distance/rings
function sigToUserId (sigId) { return sigId?.split('_')[0] ?? sigId }

// ── Shared talking state (exported for sidebar + 3D ring) ────────────
export const talkingPeers = ref(new Set())
// Presence user IDs of peers currently connected to voice (keyed by sigToUserId)
export const connectedPeerIds = ref(new Set())
/** true when the local user has voice enabled AND mic is not muted */
export const localMicActive = ref(false)
/** true when the local user has joined voice (regardless of mute state) */
export const localVoiceEnabled = ref(false)
/** Call to forcibly mute the local mic (e.g. on room leave) */
let _muteLocalFn = null
export function muteLocal () { _muteLocalFn?.() }




/**
 * Per-peer audio analysers keyed by signalingId.
 * Exported so useWorldEngine can read amplitude each render frame,
 * giving frame-accurate mouth sync without a signaling round-trip.
 */
export const peerAnalysers = new Map()  // signalingId → { analyser, buf }

export function useProximityVoice () {
	const audio = useAudio()
	const presenceStore = usePresenceStore()

	// ── Reactive state ──────────────────────────────────────────────
	const isEnabled = ref(false)
	const isMuted = ref(true)
	watch([isEnabled, isMuted], ([enabled, muted]) => { localMicActive.value = enabled && !muted }, { immediate: true })
	const isPTT = ref(false)
	const isTalking = ref(false)
	const micError = ref(null)
	const nearbyUsers = ref([])
	const audioLevel = ref(0)          // 0–1, updated by VAD
	const audioDevices = ref([])      // MediaDeviceInfo[]
	const LS_MIC = 'ava_voice_mic'
	const LS_SPK = 'ava_voice_spk'
	const selectedMicId = ref(localStorage.getItem(LS_MIC) || '')
	const selectedSpkId = ref(localStorage.getItem(LS_SPK) || '')

	// ── Local media ─────────────────────────────────────────────────
	const rtSocket = useRealtimeSocket()
	let localStream = null
	let myUserId = null
	let myRoomId = null

	// WHY: Keep myUserId in sync with the presence list-item ID.
	// Auto-join fires before presence loads so enable() may capture a stale ID.
	// Once presence resolves, update so talkingPeers carries the correct key
	// that avatarGroups uses — otherwise setAvatarTalking() can't find the avatar.
	watch(() => presenceStore.myUserId, (id) => {
		if (id) myUserId = id
	})

	// ── Init: acquire mic ───────────────────────────────────────────
	async function enable (userId, roomId) {
		if (isEnabled.value) return
		if (!userId || userId === 'me') {
			console.warn('[voice] enable() called without a resolved userId — aborting')
			return
		}
		myUserId = userId
		myRoomId = roomId
		voiceRoomId = roomId
		micError.value = null

		// navigator.mediaDevices is only available on secure contexts (localhost or HTTPS).
		// Accessing via an IP address will leave it undefined.
		if (!navigator.mediaDevices?.getUserMedia) {
			micError.value = import.meta.env.DEV
				? 'Voice requires localhost, not an IP address (mic needs a secure context)'
				: 'Microphone unavailable — page must be served over HTTPS'
			return
		}

		try {
			localStream = await navigator.mediaDevices.getUserMedia({
				audio: {
					...(selectedMicId.value ? { deviceId: { ideal: selectedMicId.value } } : {}),
					echoCancellation: true,
					noiseSuppression: true,
					autoGainControl: true,
				},
				video: false,
			})

			// Always start muted — matches isMuted initial state
			localStream.getAudioTracks().forEach(t => { t.enabled = false })

			// Create and resume AudioContext here, inside the user-gesture scope of
			// getUserMedia, so it is never in suspended state for VAD or peer analysers.
			if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)()
			audioCtx.resume()

			isEnabled.value = true
			localVoiceEnabled.value = true
			setupSignaling(userId, roomId)
		} catch (err) {
			micError.value = err.name === 'NotAllowedError'
				? 'Microphone permission denied — allow mic access in your browser'
				: (err.message || 'Microphone access denied')
		}
	}

	// ── Signaling via shared WebSocket ──────────────────────────────
	// All signaling message handlers registered with the shared socket
	const _handlerRefs = []

	function _on (type, cb) {
		rtSocket.on(type, cb)
		_handlerRefs.push([type, cb])
	}

	function _removeAllHandlers () {
		for (const [type, cb] of _handlerRefs) rtSocket.off(type, cb)
		_handlerRefs.length = 0
	}

	function setupSignaling (userId, roomId) {
		// Ensure connection is open (idempotent)
		rtSocket.connect()

		// Register all signaling message handlers on the shared socket
		_on('peer-joined', async (msg) => { await createOffer(msg.peerId) })
		_on('peer-existing', (msg) => { createPC(msg.peerId) })
		_on('offer', async (msg) => { await handleOffer(msg.peerId, msg.sdp) })
		_on('answer', async (msg) => { await handleAnswer(msg.peerId, msg.sdp) })
		_on('ice', async (msg) => { await handleIce(msg.peerId, msg.candidate) })
		_on('peer-left', (msg) => { removePeer(msg.peerId) })

		_on('room-users', (msg) => {
			// Successfully joined a new room — tear down stale peers
			for (const peerId of [...peers.keys()]) {
				if (!msg.users.includes(peerId)) removePeer(peerId)
			}
			voiceRoomId = myRoomId
			nearbyUsers.value = msg.users.filter(u => u !== userId)
		})

		_on('join-ack', (msg) => { console.debug('[voice] join confirmed:', msg.roomId) })

		_on('talking', (msg) => {
			const next = new Set(talkingPeers.value)
			if (msg.active) next.add(String(msg.userId))
			else next.delete(String(msg.userId))
			talkingPeers.value = next
		})


		// Handle open / reconnect — send join when socket opens
		_on('_open', () => {
			if (micError.value?.includes('signal') || micError.value?.includes('Signal')) {
				micError.value = null
			}
			const signalingId = myUserId ? `${myUserId}_${voiceSessionId}` : voiceSessionId
			// const admitted = _admittedToRoom === myRoomId
			// if (_admittedToRoom && admitted) _admittedToRoom = null
			send({ type: 'join', userId: signalingId, roomId: myRoomId })
			if (!isPTT.value) startVAD()
		})

		_on('_error', () => {
			if (!rtSocket.connected.value) {
				micError.value = import.meta.env.DEV
					? 'Server unreachable — run `npm run dev` (starts both Vite + server)'
					: 'Could not connect to voice server'
			}
		})

		// If already connected, send join immediately
		if (rtSocket.connected.value) {
			const signalingId = userId ? `${userId}_${voiceSessionId}` : voiceSessionId
			// const admitted = _admittedToRoom === roomId
			// if (_admittedToRoom && admitted) _admittedToRoom = null
			send({ type: 'join', userId: signalingId, roomId })
			if (!isPTT.value) startVAD()
		}
	}

	function send (msg) {
		rtSocket.send(msg)
	}

	// ── PeerConnection helpers ───────────────────────────────────────
	function createPC (peerId) {
		const pc = new RTCPeerConnection({
			iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
		})

		if (localStream) {
			localStream.getTracks().forEach(t => pc.addTrack(t, localStream))
		}

		pc.onicecandidate = ({ candidate }) => {
			if (candidate) send({ type: 'ice', peerId, candidate })
		}

		pc.ontrack = ({ streams }) => {
			if (streams?.[0]) attachRemoteAudio(peerId, streams[0])
		}

		peers.set(peerId, { pc, stream: null, audioEl: null })
		const next = new Set(connectedPeerIds.value)
		next.add(sigToUserId(peerId))
		connectedPeerIds.value = next
		return pc
	}

	async function createOffer (peerId) {
		const pc = createPC(peerId)
		try {
			const offer = await pc.createOffer()
			// Glare: received their offer while awaiting — handleOffer will answer instead
			if (pc.signalingState !== 'stable') return
			await pc.setLocalDescription(offer)
			send({ type: 'offer', peerId, sdp: pc.localDescription })
		} catch {
			// Glare: remote offer arrived between state-check and setLocalDescription.
			// handleOffer on the other side will answer — connection still establishes.
		}
	}

	async function handleOffer (peerId, sdp) {
		let pc = peers.get(peerId)?.pc
		if (!pc) pc = createPC(peerId)
		try {
			// Glare: we already sent an offer — roll back and accept theirs
			if (pc.signalingState === 'have-local-offer') {
				await pc.setLocalDescription({ type: 'rollback' })
			}
			// After rollback (or normally), we must be in stable to set remote
			if (pc.signalingState !== 'stable') return
			await pc.setRemoteDescription(new RTCSessionDescription(sdp))
			const answer = await pc.createAnswer()
			// Guard: PC may have closed or reset between createAnswer and setLocalDescription
			if (pc.signalingState !== 'have-remote-offer') return
			await pc.setLocalDescription(answer)
			send({ type: 'answer', peerId, sdp: pc.localDescription })
		} catch (e) {
			console.warn('[voice] handleOffer:', e.message)
		}
	}

	async function handleAnswer (peerId, sdp) {
		const pc = peers.get(peerId)?.pc
		// Only valid in have-local-offer; ignore duplicate/late answers
		if (!pc || pc.signalingState !== 'have-local-offer') return
		try { await pc.setRemoteDescription(new RTCSessionDescription(sdp)) } catch (e) {
			console.warn('[voice] handleAnswer:', e.message)
		}
	}

	async function handleIce (peerId, candidate) {
		if (!candidate) return   // null = end-of-candidates marker, nothing to add
		const pc = peers.get(peerId)?.pc
		if (!pc) return
		try { await pc.addIceCandidate(new RTCIceCandidate(candidate)) } catch { /* ignore */ }
	}

	function removePeer (peerId) {
		const peer = peers.get(peerId)
		if (peer) {
			peer.pc.close()
			if (peer.audioEl) { peer.audioEl.srcObject = null; peer.audioEl.remove() }
			peers.delete(peerId)
			peerAnalysers.delete(peerId)
		}
		// Clear talking ring — strip session suffix to match presence userId
		const nextTalking = new Set(talkingPeers.value)
		nextTalking.delete(String(peerId))
		nextTalking.delete(sigToUserId(peerId))
		talkingPeers.value = nextTalking
		// Clear connected set
		const nextConn = new Set(connectedPeerIds.value)
		nextConn.delete(sigToUserId(peerId))
		connectedPeerIds.value = nextConn
	}

	// Remote audio via <audio srcObject> — bypasses AudioContext autoplay restrictions.
	// Volume-based distance attenuation replaces gainNode approach.
	function attachRemoteAudio (peerId, stream) {
		const peer = peers.get(peerId)
		if (!peer) return

		// Tear down previous audio element if any
		if (peer.audioEl) { peer.audioEl.srcObject = null; peer.audioEl.remove() }

		const audioEl = new Audio()
		audioEl.srcObject = stream
		audioEl.autoplay = true
		audioEl.volume = isAllAudioMuted.value ? 0 : 1

		// Route to saved speaker device if browser supports it
		if (selectedSpkId.value && typeof audioEl.setSinkId === 'function') {
			audioEl.setSinkId(selectedSpkId.value).catch(() => { })
		}

		audioEl.play().catch(e => console.warn('[voice] remote audio play blocked:', e))

		peer.stream = stream
		peer.audioEl = audioEl

		// Tap the stream with an AnalyserNode so the 3D engine can read amplitude
		// each render frame — gives frame-accurate mouth sync with no signaling lag.
		try {
			if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)()
			if (audioCtx.state === 'suspended') audioCtx.resume()
			const source = audioCtx.createMediaStreamSource(stream)
			const analyser = audioCtx.createAnalyser()
			analyser.fftSize = 256
			source.connect(analyser)  // analysis only — NOT connected to destination
			peerAnalysers.set(peerId, { analyser, buf: new Uint8Array(analyser.frequencyBinCount) })
		} catch (e) {
			console.warn('[voice] analyser setup failed:', e)
		}
	}

	// ── Spatial attenuation ─────────────────────────────────────────
	/**
	 * Update audio volume for a peer based on 2D distance from local user.
	 * @param {string} peerId
	 * @param {number} distance - world units
	 */
	function setDistance (peerId, distance) {
		const peer = peers.get(peerId)
		if (!peer?.audioEl) return
		peer._lastDist = distance
		const base = Math.max(0, 1 - distance / 12)
		peer.audioEl.volume = isAllAudioMuted.value ? 0 : base
	}

	// ── Voice activity detection (open-mic mode) ────────────────────
	let vadTimer = null
	const VAD_THRESHOLD = 12   // average frequency amplitude — tune if too sensitive

	function startVAD () {
		stopVAD()
		if (!localStream) return
		if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)()
		const analyser = audioCtx.createAnalyser()
		analyser.fftSize = 512
		const source = audioCtx.createMediaStreamSource(localStream)
		source.connect(analyser)   // analyse only — do NOT connect to destination
		const buf = new Uint8Array(analyser.frequencyBinCount)
		let lastSpeaking = false
		vadTimer = setInterval(() => {
			if (!isEnabled.value || isPTT.value || isMuted.value) {
				audioLevel.value = 0
				// Ensure talking state is cleared when muted so the mouth closes
				if (lastSpeaking) {
					lastSpeaking = false
					isTalking.value = false
					setOwnTalkingRing(false)
					send({ type: 'talking', userId: myUserId, active: false })
				}
				return
			}
			analyser.getByteFrequencyData(buf)
			const avg = buf.reduce((a, b) => a + b, 0) / buf.length
			audioLevel.value = Math.min(1, avg / 80)
			const speaking = avg > VAD_THRESHOLD
			if (speaking === lastSpeaking) return
			lastSpeaking = speaking
			isTalking.value = speaking
			setOwnTalkingRing(speaking)
			send({ type: 'talking', userId: myUserId, active: speaking })
		}, 80)
	}

	function stopVAD () {
		clearInterval(vadTimer)
		vadTimer = null
	}

	function setOwnTalkingRing (active) {
		const next = new Set(talkingPeers.value)
		if (active) next.add(String(myUserId))
		else next.delete(String(myUserId))
		talkingPeers.value = next
	}

	// ── PTT control ─────────────────────────────────────────────────
	function startTalking () {
		if (!localStream || isTalking.value) return
		localStream.getAudioTracks().forEach(t => { t.enabled = true })
		isTalking.value = true
		isMuted.value = false
		audio.playPTTStart()
		setOwnTalkingRing(true)
		send({ type: 'talking', userId: myUserId, active: true })
	}

	function stopTalking () {
		if (!localStream || !isTalking.value) return
		localStream.getAudioTracks().forEach(t => { t.enabled = false })
		isTalking.value = false
		isMuted.value = true
		audio.playPTTStop()
		setOwnTalkingRing(false)
		send({ type: 'talking', userId: myUserId, active: false })
	}

	function toggleMute () {
		if (!localStream) return
		const muted = !isMuted.value
		localStream.getAudioTracks().forEach(t => { t.enabled = !muted })
		isMuted.value = muted
		isTalking.value = !muted
	}

	function forceMute () {
		if (!localStream || isMuted.value) return
		localStream.getAudioTracks().forEach(t => { t.enabled = false })
		isMuted.value = true
		isTalking.value = false
		setOwnTalkingRing(false)
		send({ type: 'talking', userId: myUserId, active: false })
	}
	_muteLocalFn = forceMute

	function setPTTMode (val) {
		isPTT.value = val
		if (val) {
			stopVAD()
			if (localStream) {
				localStream.getAudioTracks().forEach(t => { t.enabled = false })
				isMuted.value = true
				isTalking.value = false
				setOwnTalkingRing(false)
			}
		} else if (isEnabled.value) {
			isMuted.value = false
			if (localStream) localStream.getAudioTracks().forEach(t => { t.enabled = true })
			startVAD()
		}
	}

	// ── Move to a different room ─────────────────────────────────────
	// voiceRoomId tracks the actual room we're connected to for voice.
	let voiceRoomId = null

	function changeRoom (roomId) {
		if (!isEnabled.value) return
		// Already in this room — do nothing. This is the normal post-admit path:
		// watcher that fires moments later finds us already in place and does
		// not emit a redundant change-room that would tear down the peer
		// connection the server just established.
		if (roomId === myRoomId) return
		myRoomId = roomId
		const signalingId = myUserId ? `${myUserId}_${voiceSessionId}` : voiceSessionId
		send({ type: 'change-room', userId: signalingId, roomId })
		// Peers are cleaned up on successful join (room-users) or on
		// explicit navigation away.
	}

	// ── Cleanup ──────────────────────────────────────────────────────
	function disable () {
		stopVAD()
		setOwnTalkingRing(false)
		for (const peerId of [...peers.keys()]) removePeer(peerId)
		_removeAllHandlers()
		// Don't close the shared socket — other composables may use it (Phase 2+)
		localStream?.getTracks().forEach(t => t.stop())
		localStream = null
		isEnabled.value = false
		localVoiceEnabled.value = false
		isTalking.value = false
		isMuted.value = true
		voiceRoomId = null
	}



	// ── Device management ────────────────────────────────────────────
	async function loadDevices () {
		try {
			const all = await navigator.mediaDevices.enumerateDevices()
			audioDevices.value = all.filter(d => d.kind === 'audioinput' || d.kind === 'audiooutput')
			// Auto-select defaults on first open (saved value takes priority)
			if (!selectedMicId.value) {
				const d = audioDevices.value.find(d => d.kind === 'audioinput' && d.deviceId === 'default')
					?? audioDevices.value.find(d => d.kind === 'audioinput')
				if (d) { selectedMicId.value = d.deviceId; localStorage.setItem(LS_MIC, d.deviceId) }
			}
			if (!selectedSpkId.value) {
				const d = audioDevices.value.find(d => d.kind === 'audiooutput' && d.deviceId === 'default')
					?? audioDevices.value.find(d => d.kind === 'audiooutput')
				if (d) { selectedSpkId.value = d.deviceId; localStorage.setItem(LS_SPK, d.deviceId) }
			}
		} catch { /* ignore */ }
	}

	async function setMicDevice (deviceId) {
		selectedMicId.value = deviceId
		localStorage.setItem(LS_MIC, deviceId)
		if (!localStream) return
		try {
			const newStream = await navigator.mediaDevices.getUserMedia({
				audio: { deviceId: { exact: deviceId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
				video: false,
			})
			const [newTrack] = newStream.getAudioTracks()
			newTrack.enabled = !isMuted.value
			// Replace track in all peer connections
			for (const { pc } of peers.values()) {
				const sender = pc.getSenders().find(s => s.track?.kind === 'audio')
				if (sender) sender.replaceTrack(newTrack)
			}
			localStream.getAudioTracks().forEach(t => t.stop())
			localStream = newStream
			stopVAD(); startVAD()
		} catch (err) {
			micError.value = `Mic switch failed: ${err.message}`
		}
	}

	async function setSpeakerDevice (deviceId) {
		selectedSpkId.value = deviceId
		localStorage.setItem(LS_SPK, deviceId)
		// Apply to all active remote audio elements
		for (const peer of peers.values()) {
			if (peer.audioEl && typeof peer.audioEl.setSinkId === 'function') {
				peer.audioEl.setSinkId(deviceId).catch(() => { })
			}
		}
	}

	onUnmounted(disable)

	return {
		isEnabled,
		isMuted,
		isPTT,
		isTalking,
		micError,
		nearbyUsers,
		audioLevel,
		audioDevices,
		selectedMicId,
		selectedSpkId,
		enable,
		disable,
		startTalking,
		stopTalking,
		toggleMute,
		setPTTMode,
		setDistance,
		loadDevices,
		setMicDevice,
		setSpeakerDevice,
	}
}
