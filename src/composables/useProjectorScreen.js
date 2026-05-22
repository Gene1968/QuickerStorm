/**
 * useProjectorScreen — factory for canvas-backed screen meshes.
 *
 * Each call returns an independent instance with its own canvas + texture,
 * so the conference-room projector and the office wall screen can coexist.
 *
 * Phase 1: Canvas 2D content (calendar).
 * Phase 3: call attachVideoTexture(mediaStreamTrack) to swap to VideoTexture.
 */
import * as THREE from 'three'

const CANVAS_W = 1024
const CANVAS_H = 576   // 16:9

export function useProjectorScreen() {
	let _canvas  = null
	let _ctx     = null
	let _texture = null
	let _mesh    = null
	let _defaultMaterial = null

	function _ensureCanvas() {
		if (_canvas) return
		_canvas        = document.createElement('canvas')
		_canvas.width  = CANVAS_W
		_canvas.height = CANVAS_H
		_ctx     = _canvas.getContext('2d')
		_texture = new THREE.CanvasTexture(_canvas)
		_texture.colorSpace     = THREE.SRGBColorSpace
		_texture.generateMipmaps = false
		_texture.minFilter      = THREE.LinearFilter
	}

	/** Attach our canvas texture to the given mesh. */
	function applyToMesh(mesh) {
		if (!mesh) return
		_ensureCanvas()
		_mesh            = mesh
		_defaultMaterial = mesh.material
		mesh.material = new THREE.MeshStandardMaterial({
			map:               _texture,
			emissiveMap:       _texture,
			emissive:          new THREE.Color(0xffffff),
			emissiveIntensity: 0.55,
			roughness:         0.85,
			metalness:         0.0,
		})
		_drawBlank()
	}

	/** Restore the original static material (e.g. on room leave). */
	function detachFromMesh() {
		if (!_mesh || !_defaultMaterial) return
		_mesh.material = _defaultMaterial
		_mesh          = null
	}

	// ── Conference / projector view ────────────────────────────────────
	/**
	 * Draw current-or-next meeting for the conference-room projector.
	 * @param {{ currentEvent, nextEvent, isAuthed: boolean, jitsiActive?: boolean, jitsiParticipants?: number }} state
	 */
	function draw({ currentEvent, nextEvent, isAuthed, jitsiActive = false, jitsiParticipants = 0 }) {
		if (!_ctx || !_texture) return
		const W = CANVAS_W, H = CANVAS_H

		_ctx.fillStyle = '#060e18'
		_ctx.fillRect(0, 0, W, H)

		// Header bar
		_ctx.fillStyle = '#0b1e36'
		_ctx.fillRect(0, 0, W, 58)
		_ctx.fillStyle = '#00b4d8'
		_ctx.font = 'bold 22px sans-serif'
		_ctx.textAlign = 'left'
		_ctx.fillText('AVA Conference Room', 22, 38)
		_ctx.fillStyle = '#50708a'
		_ctx.font = '20px sans-serif'
		_ctx.textAlign = 'right'
		_ctx.fillText(_clock(), W - 22, 38)
		_ctx.textAlign = 'left'

		if (jitsiActive) {
			_drawJitsiLive(currentEvent, jitsiParticipants, W, H)
		} else if (!isAuthed) {
			_centered('📅 Connect Google Calendar', W, H, '#3a5070', 'bold 24px sans-serif', -28)
			_centered('Settings → Google → Connect', W, H, '#2a3d55', '18px sans-serif', 14)
		} else if (currentEvent) {
			_drawLive(currentEvent, W)
		} else if (nextEvent) {
			_drawUpcoming(nextEvent, W)
		} else {
			_centered('No meetings scheduled today', W, H, '#2a3d55', '22px sans-serif', 0)
		}

		_texture.needsUpdate = true
	}

	// ── Office wall-screen view ─────────────────────────────────────────
	/**
	 * Draw a full-day schedule view for the personal office screen.
	 * Shows up to 5 events with times; highlights current and next.
	 * @param {{ events: Array, currentEvent, nextEvent, isAuthed: boolean }} state
	 */
	function drawOffice({ events, currentEvent, nextEvent, isAuthed }) {
		if (!_ctx || !_texture) return
		const W = CANVAS_W, H = CANVAS_H
		const now = Date.now()

		_ctx.fillStyle = '#060e18'
		_ctx.fillRect(0, 0, W, H)

		// Header
		_ctx.fillStyle = '#0b1e36'
		_ctx.fillRect(0, 0, W, 52)
		_ctx.fillStyle = '#00b4d8'
		_ctx.font = 'bold 19px sans-serif'
		_ctx.textAlign = 'left'
		_ctx.fillText('My Calendar — ' + _today(), 18, 34)
		_ctx.fillStyle = '#50708a'
		_ctx.font = '18px sans-serif'
		_ctx.textAlign = 'right'
		_ctx.fillText(_clock(), W - 18, 34)
		_ctx.textAlign = 'left'

		if (!isAuthed) {
			_centered('📅 Connect Google Calendar', W, H, '#3a5070', 'bold 22px sans-serif', -20)
			_centered('Settings → Integrations → Connect Google', W, H, '#2a3d55', '16px sans-serif', 16)
			_texture.needsUpdate = true
			return
		}

		const todayEvents = (events || []).filter(ev => _endMs(ev) > now - 60_000)
		if (!todayEvents.length) {
			_centered('No upcoming meetings ✓', W, H, '#203040', 'bold 22px sans-serif', 0)
			_texture.needsUpdate = true
			return
		}

		// List up to 6 events
		const visible = todayEvents.slice(0, 6)
		const rowH = (H - 60) / visible.length
		visible.forEach((ev, i) => {
			const y = 58 + i * rowH
			const isCurrent = currentEvent && ev === currentEvent
			const isNext    = !isCurrent && nextEvent && ev === nextEvent
			const isPast    = _endMs(ev) < now

			// Row background
			if (isCurrent) {
				_ctx.fillStyle = 'rgba(0,200,100,0.10)'
				_ctx.fillRect(0, y, W, rowH)
				_ctx.fillStyle = 'rgba(0,200,100,0.35)'
				_ctx.fillRect(0, y, 4, rowH)
			} else if (isNext) {
				_ctx.fillStyle = 'rgba(0,180,220,0.08)'
				_ctx.fillRect(0, y, W, rowH)
				_ctx.fillStyle = 'rgba(0,180,220,0.5)'
				_ctx.fillRect(0, y, 4, rowH)
			} else if (!isPast) {
				_ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent'
				_ctx.fillRect(0, y, W, rowH)
			}

			// Time
			const timeStr = `${_fmt(ev.start)} – ${_fmt(ev.end)}`
			_ctx.fillStyle = isPast ? '#2a3d55' : (isCurrent ? '#00c860' : isNext ? '#40b0d8' : '#507090')
			_ctx.font = `${isCurrent || isNext ? 'bold ' : ''}15px sans-serif`
			_ctx.fillText(timeStr, 18, y + rowH * 0.42)

			// Title
			_ctx.fillStyle = isPast ? '#2a4060' : (isCurrent ? '#d0fce0' : isNext ? '#c8eaf8' : '#a0c0d8')
			_ctx.font = `${isCurrent || isNext ? 'bold ' : ''}17px sans-serif`
			_ctx.fillText(_truncate(ev.summary || 'Untitled', 38), 18, y + rowH * 0.78)

			// Separator
			_ctx.strokeStyle = 'rgba(255,255,255,0.04)'
			_ctx.lineWidth = 1
			_ctx.beginPath()
			_ctx.moveTo(0, y + rowH)
			_ctx.lineTo(W, y + rowH)
			_ctx.stroke()
		})

		_texture.needsUpdate = true
	}

	// ── Phase 3 hook (Jitsi) ─────────────────────────────────────────
	function attachVideoTexture(mediaStreamTrack) {
		if (!_mesh) return
		if (!mediaStreamTrack) {
			if (_mesh.material.map !== _texture) {
				_mesh.material.map = _texture
				_mesh.material.emissiveMap = _texture
				_mesh.material.needsUpdate = true
			}
			return
		}
		const stream = new MediaStream([mediaStreamTrack])
		const video = document.createElement('video')
		video.srcObject = stream
		video.muted = true
		video.playsInline = true
		video.play()
		const vt = new THREE.VideoTexture(video)
		_mesh.material.map = vt
		_mesh.material.emissiveMap = vt
		_mesh.material.needsUpdate = true
	}

	// ── Private helpers ──────────────────────────────────────────────
	function _drawJitsiLive(currentEvent, participants, W, H) {
		// Pulsing red "LIVE" badge
		_ctx.fillStyle = '#c01818'
		_ctx.beginPath()
		_ctx.roundRect(22, 78, 88, 30, 4)
		_ctx.fill()
		_ctx.fillStyle = '#fff'
		_ctx.font = 'bold 15px sans-serif'
		_ctx.fillText('● LIVE', 33, 98)

		// Meeting title
		const title = currentEvent?.summary || 'Meeting in Session'
		_ctx.fillStyle = '#e8f4ff'
		_ctx.font = 'bold 32px sans-serif'
		_ctx.fillText(_truncate(title, 38), 22, 158)

		// Time range
		if (currentEvent) {
			_ctx.fillStyle = '#507090'
			_ctx.font = '18px sans-serif'
			_ctx.fillText(`${_fmt(currentEvent.start)} – ${_fmt(currentEvent.end)}`, 22, 194)
		}

		// Participant count
		if (participants > 0) {
			_ctx.fillStyle = '#304a64'
			_ctx.font = '16px sans-serif'
			_ctx.fillText(`👥 ${participants} participant${participants !== 1 ? 's' : ''} in call`, 22, 230)
		}

		// Join prompt
		_centered('Join via the Meeting panel →', W, H, '#203040', '16px sans-serif', H * 0.22)
	}

	function _drawBlank() {
		if (!_ctx || !_texture) return
		_ctx.fillStyle = '#060e18'
		_ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)
		_texture.needsUpdate = true
	}

	function _drawLive(ev, _W) {
		_ctx.fillStyle = '#00c853'
		_ctx.font = 'bold 16px sans-serif'
		_ctx.fillText('● IN PROGRESS', 22, 98)
		_ctx.fillStyle = '#e2ecf8'
		_ctx.font = 'bold 30px sans-serif'
		_ctx.fillText(_truncate(ev.summary || 'Meeting', 44), 22, 148)
		_ctx.fillStyle = '#507090'
		_ctx.font = '18px sans-serif'
		_ctx.fillText(`${_fmt(ev.start)} – ${_fmt(ev.end)}`, 22, 184)
		const names = (ev.attendees || []).slice(0, 7)
			.map(a => a.displayName || a.email?.split('@')[0] || '').filter(Boolean)
		if (names.length) {
			_ctx.fillStyle = '#3a5570'
			_ctx.font = '15px sans-serif'
			_ctx.fillText('Attendees: ' + names.join(', '), 22, 220)
		}
	}

	function _drawUpcoming(ev, _W) {
		const minsUntil = Math.max(0, Math.round((_startMs(ev) - Date.now()) / 60_000))
		const soon = minsUntil <= 10
		_ctx.fillStyle = soon ? '#ff6d00' : '#3a5570'
		_ctx.font = 'bold 16px sans-serif'
		_ctx.fillText(soon ? `⚠ Starting in ${minsUntil} min` : `Next in ${minsUntil} min`, 22, 98)
		_ctx.fillStyle = soon ? '#ffd0a0' : '#c0d8f0'
		_ctx.font = 'bold 28px sans-serif'
		_ctx.fillText(_truncate(ev.summary || 'Meeting', 46), 22, 148)
		_ctx.fillStyle = '#507090'
		_ctx.font = '18px sans-serif'
		_ctx.fillText(`${_fmt(ev.start)} – ${_fmt(ev.end)}`, 22, 184)
	}

	function _centered(text, W, H, color, font, offsetY = 0) {
		_ctx.fillStyle = color
		_ctx.font = font
		_ctx.textAlign = 'center'
		_ctx.fillText(text, W / 2, H / 2 + offsetY)
		_ctx.textAlign = 'left'
	}

	function _fmt(bound) {
		if (!bound) return ''
		return new Date(bound.dateTime || bound.date)
			.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
	}

	function _startMs(ev) { return new Date(ev.start?.dateTime || ev.start?.date).getTime() }
	function _endMs(ev)   { return new Date(ev.end?.dateTime   || ev.end?.date).getTime()   }

	function _clock() {
		return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
	}

	function _today() {
		return new Date().toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
	}

	function _truncate(str, maxLen) {
		return str.length > maxLen ? str.slice(0, maxLen - 1) + '…' : str
	}

	return { applyToMesh, detachFromMesh, draw, drawOffice, attachVideoTexture }
}
