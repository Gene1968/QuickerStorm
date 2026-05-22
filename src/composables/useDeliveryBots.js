/**
 * useDeliveryBots — periodic parcel deliveries to the lobby reception desk.
 *
 * Every BUCKET_MS a courier-themed bot walks in from the south door of the
 * lobby, drops a package on the reception desk, and walks back out. Past
 * buckets persist as packages on the desk with a hover label showing the
 * carrier and a random QuickerStorm user as the recipient.
 *
 * Determinism: carrier + recipient are derived from the bucket index so all
 * clients see the same packages on the desk. The walk animation only plays
 * when the local user is currently in the lobby.
 */

import * as THREE from 'three'
import { gsap } from 'gsap'
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import { carrierForBucket } from '@/config/deliveryCarriers.js'
import { usePresenceStore } from '@/stores/presenceStore.js'
import { useOfficeStore } from '@/stores/officeStore.js'

const BUCKET_MS = 4 * 60 * 1000
const MAX_PACKAGES = 5

const SPAWN_POS = { x: -18, z: 13 }
const DESK_FRONT_POS = { x: -18, z: -3.6 }
const DESK_TOP_Y = 0.78
const PACKAGE_HALF_H = 0.13

const SLOT_OFFSETS_X = [-1.6, -0.8, 0, 0.8, 1.6]

let _engine = null
let _running = false
let _bucketTimer = null
let _activeBotCleanup = null
const _packages = new Map() // bucket → { entityId }

export function useDeliveryBots () {
	return { start, stop }
}

function start (engine) {
	if (_running || !engine) return
	_engine = engine
	_running = true

	const now = Date.now()
	const currentBucket = Math.floor(now / BUCKET_MS)
	for (let i = MAX_PACKAGES - 1; i >= 1; i--) {
		_placePackage(currentBucket - i, { animate: false })
	}

	const msToNext = (currentBucket + 1) * BUCKET_MS - now
	_bucketTimer = setTimeout(_onBucketTick, msToNext)
}

function stop () {
	_running = false
	if (_bucketTimer) { clearTimeout(_bucketTimer); _bucketTimer = null }
	_activeBotCleanup?.()
	_activeBotCleanup = null
	for (const [, p] of _packages) _engine?.removeEntity?.(p.entityId)
	_packages.clear()
	_engine = null
}

function _onBucketTick () {
	if (!_running) return
	const bucket = Math.floor(Date.now() / BUCKET_MS)
	const inLobby = useOfficeStore().currentRoomId === 'lobby'
	_placePackage(bucket, { animate: inLobby })
	const msToNext = (bucket + 1) * BUCKET_MS - Date.now()
	_bucketTimer = setTimeout(_onBucketTick, Math.max(1000, msToNext))
}

function _hash (n) {
	let x = n | 0
	x = ((x ^ 61) ^ (x >>> 16)) | 0
	x = (x + (x << 3)) | 0
	x = (x ^ (x >>> 4)) | 0
	x = Math.imul(x, 0x27d4eb2d)
	x = (x ^ (x >>> 15)) | 0
	return x
}

function _slotForBucket (bucket) {
	const slot = ((bucket % MAX_PACKAGES) + MAX_PACKAGES) % MAX_PACKAGES
	return SLOT_OFFSETS_X[slot]
}

function _pickRecipient (bucket) {
	const presence = usePresenceStore()
	const candidates = (presence.users || [])
		.filter((u) => u.name && !u.email?.includes('@localhost'))
		.map((u) => u.name)
		.sort()
	if (!candidates.length) return 'Reception'
	return candidates[Math.abs(_hash(bucket * 31 + 11)) % candidates.length]
}

function _placePackage (bucket, { animate }) {
	if (!_engine || _packages.has(bucket)) return

	const carrier = carrierForBucket(bucket)
	const recipient = _pickRecipient(bucket)
	const slotX = _slotForBucket(bucket)
	const targetWorld = {
		x: -18 + slotX,
		y: DESK_TOP_Y + PACKAGE_HALF_H,
		z: -5,
	}
	const finalRotY = (Math.abs(_hash(bucket)) % 60 - 30) * Math.PI / 180

	for (const [b, p] of [..._packages]) {
		if (_slotForBucket(b) === slotX) {
			_engine.removeEntity(p.entityId)
			_packages.delete(b)
		}
	}

	const { group, labelMeshes, label } = _buildPackage(carrier, recipient, bucket)
	const pkgEntityId = `delivery-pkg-${bucket}`

	if (!animate) {
		group.position.set(targetWorld.x, targetWorld.y, targetWorld.z)
		group.rotation.y = finalRotY
		_engine.addEntity({
			id: pkgEntityId,
			group,
			hoverables: labelMeshes,
			getLabel: () => label,
		})
		_packages.set(bucket, { entityId: pkgEntityId })
		return
	}

	_runDelivery({ bucket, carrier, recipient, targetWorld, finalRotY, packageGroup: group, labelMeshes, labelText: label, pkgEntityId })
}

function _runDelivery ({ bucket, carrier, targetWorld, finalRotY, packageGroup, labelMeshes, labelText, pkgEntityId }) {
	_activeBotCleanup?.()

	const bot = _buildBot(carrier)
	const botGroup = bot.group

	botGroup.position.set(SPAWN_POS.x, 0, SPAWN_POS.z)
	botGroup.rotation.y = Math.PI

	bot.heldSlot.add(packageGroup)
	packageGroup.position.set(0, 0, 0)
	packageGroup.rotation.set(0, 0, 0)

	const botEntityId = `delivery-bot-${bucket}-${Date.now()}`
	_engine.addEntity({ id: botEntityId, group: botGroup, hoverables: [], getLabel: null })

	let swingTweens = []
	function startSwing () {
		stopSwing()
		bot.armL.rotation.x = 0.5
		bot.armR.rotation.x = -0.5
		swingTweens.push(gsap.to(bot.armL.rotation, { x: -0.5, duration: 0.4, yoyo: true, repeat: -1, ease: 'sine.inOut' }))
		swingTweens.push(gsap.to(bot.armR.rotation, { x: 0.5, duration: 0.4, yoyo: true, repeat: -1, ease: 'sine.inOut' }))
	}
	function stopSwing () {
		for (const t of swingTweens) t.kill()
		swingTweens = []
	}

	let cleaned = false
	const cleanup = () => {
		if (cleaned) return
		cleaned = true
		stopSwing()
		tl.kill()
		_engine?.removeEntity?.(botEntityId)
		if (_activeBotCleanup === cleanup) _activeBotCleanup = null
	}
	_activeBotCleanup = cleanup

	const tl = gsap.timeline({ onComplete: cleanup })

	tl.from(botGroup.scale, { x: 0.2, y: 0.2, z: 0.2, duration: 0.35, ease: 'back.out(1.4)' })
	tl.add(startSwing)

	tl.to(botGroup.position, {
		x: DESK_FRONT_POS.x, z: DESK_FRONT_POS.z,
		duration: 3.0, ease: 'power1.inOut',
	})

	tl.add(stopSwing)
	tl.to([bot.armL.rotation, bot.armR.rotation], { x: -0.6, duration: 0.25 })

	tl.add(() => {
		bot.heldSlot.remove(packageGroup)
		const worldPos = new THREE.Vector3()
		bot.heldSlot.getWorldPosition(worldPos)
		packageGroup.position.copy(worldPos)
		packageGroup.rotation.set(0, 0, 0)
		_engine.addEntity({
			id: pkgEntityId,
			group: packageGroup,
			hoverables: labelMeshes,
			getLabel: () => labelText,
		})
		_packages.set(bucket, { entityId: pkgEntityId })

		gsap.to(packageGroup.position, {
			x: targetWorld.x, y: targetWorld.y, z: targetWorld.z,
			duration: 0.55, ease: 'power2.in',
		})
		gsap.to(packageGroup.rotation, { y: finalRotY, duration: 0.55, ease: 'power2.out' })
	})

	tl.to([bot.armL.rotation, bot.armR.rotation], { x: 0, duration: 0.3 }, '+=0.6')
	tl.to(botGroup.rotation, { y: 0, duration: 0.5, ease: 'power2.inOut' })

	tl.add(startSwing)
	tl.to(botGroup.position, {
		x: SPAWN_POS.x, z: SPAWN_POS.z,
		duration: 3.0, ease: 'power1.inOut',
	})
	tl.add(stopSwing)
	tl.to(botGroup.scale, { x: 0.05, y: 0.05, z: 0.05, duration: 0.3, ease: 'back.in(1.2)' })
}

// ── Bot avatar mesh ─────────────────────────────────────────────────────

function _buildBot (carrier) {
	const group = new THREE.Group()
	group.name = `delivery-bot-${carrier.id}`

	const primary = new THREE.Color(carrier.primary)
	const secondary = new THREE.Color(carrier.secondary)
	const skin = new THREE.Color('#C68642')
	const dark = new THREE.Color('#2a2118')

	const matPrimary = new THREE.MeshStandardMaterial({ color: primary, roughness: 0.7 })
	const matSecondary = new THREE.MeshStandardMaterial({ color: secondary, roughness: 0.7 })
	const matSkin = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.75 })
	const matDark = new THREE.MeshStandardMaterial({ color: dark, roughness: 0.6 })

	const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.20, 0.25, 4, 12), matPrimary)
	torso.position.y = 0.96
	torso.castShadow = true
	group.add(torso)

	const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.06, 16), matDark)
	belt.position.y = 0.78
	group.add(belt)

	const armL = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.38, 4, 8), matPrimary)
	armL.position.set(-0.26, 0.96, 0)
	armL.rotation.z = -0.15
	armL.castShadow = true
	group.add(armL)

	const armR = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.38, 4, 8), matPrimary)
	armR.position.set(0.26, 0.96, 0)
	armR.rotation.z = 0.15
	armR.castShadow = true
	group.add(armR)

	for (const lx of [-1, 1]) {
		const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.105, 0.48, 4, 8), matSecondary)
		leg.position.set(lx * 0.1, 0.44, 0)
		leg.castShadow = true
		group.add(leg)
	}

	const HEAD_Y = 1.44
	const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), matSkin)
	head.position.y = HEAD_Y
	head.castShadow = true
	group.add(head)

	const capDome = new THREE.Mesh(
		new THREE.SphereGeometry(0.21, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.5),
		matPrimary,
	)
	capDome.position.set(0, HEAD_Y + 0.02, 0)
	group.add(capDome)

	const capBand = new THREE.Mesh(
		new THREE.CylinderGeometry(0.21, 0.21, 0.04, 16, 1, true),
		matSecondary,
	)
	capBand.position.set(0, HEAD_Y + 0.04, 0)
	group.add(capBand)

	const capBrim = new THREE.Mesh(
		new THREE.BoxGeometry(0.32, 0.025, 0.12),
		matPrimary,
	)
	capBrim.position.set(0, HEAD_Y + 0.04, 0.18)
	group.add(capBrim)

	const eyeMat = new THREE.MeshStandardMaterial({ color: 0x050a10, roughness: 1 })
	for (const ex of [-0.07, 0.07]) {
		const eye = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6), eyeMat)
		eye.position.set(ex, HEAD_Y + 0.06, 0.17)
		group.add(eye)
	}

	const heldSlot = new THREE.Group()
	heldSlot.position.set(0, 1.0, 0.32)
	group.add(heldSlot)

	const labelEl = document.createElement('div')
	labelEl.className = 'avatar-label'
	labelEl.style.opacity = '0.92'
	labelEl.style.background = carrier.primary
	labelEl.style.color = carrier.text
	labelEl.style.fontWeight = '700'
	labelEl.style.padding = '0.125rem 0.5rem'
	labelEl.style.borderRadius = '0.25rem'
	labelEl.style.border = `0.0625rem solid ${carrier.secondary}`
	labelEl.textContent = `${carrier.name} Courier`
	const label = new CSS2DObject(labelEl)
	label.position.set(0, 2.1, 0)
	group.add(label)

	return { group, armL, armR, heldSlot }
}

// ── Package mesh + label texture ─────────────────────────────────────────

function _buildPackage (carrier, recipient, bucket) {
	const group = new THREE.Group()
	group.name = `delivery-pkg-${carrier.id}`

	const W = 0.45, H = PACKAGE_HALF_H * 2, D = 0.32
	const cardboard = new THREE.MeshStandardMaterial({ color: 0xc8a472, roughness: 0.85 })
	const tape = new THREE.MeshStandardMaterial({ color: 0xe8e0c4, roughness: 0.6 })

	const labelTex = _makeLabelTexture(carrier, recipient, bucket)
	const labelMat = new THREE.MeshStandardMaterial({ map: labelTex, roughness: 0.9 })

	// BoxGeometry face order: +X, -X, +Y (top), -Y, +Z, -Z
	const mats = [cardboard, cardboard, labelMat, cardboard, cardboard, cardboard]
	const box = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), mats)
	box.castShadow = true
	box.receiveShadow = true
	group.add(box)

	// Side seam tape — runs around the equator on the four side faces, leaving
	// the top label fully visible.
	const seamY = 0
	const seamH = 0.025
	const tapeFront = new THREE.Mesh(new THREE.BoxGeometry(W + 0.002, seamH, 0.001), tape)
	tapeFront.position.set(0, seamY, D / 2 + 0.0015)
	group.add(tapeFront)
	const tapeBack = new THREE.Mesh(new THREE.BoxGeometry(W + 0.002, seamH, 0.001), tape)
	tapeBack.position.set(0, seamY, -D / 2 - 0.0015)
	group.add(tapeBack)
	const tapeRight = new THREE.Mesh(new THREE.BoxGeometry(0.001, seamH, D + 0.002), tape)
	tapeRight.position.set(W / 2 + 0.0015, seamY, 0)
	group.add(tapeRight)
	const tapeLeft = new THREE.Mesh(new THREE.BoxGeometry(0.001, seamH, D + 0.002), tape)
	tapeLeft.position.set(-W / 2 - 0.0015, seamY, 0)
	group.add(tapeLeft)

	return {
		group,
		labelMeshes: [box],
		label: `📦 For ${recipient}, via ${carrier.name}`,
	}
}

function _makeLabelTexture (carrier, recipient, bucket) {
	const W = 256, H = 192
	const canvas = document.createElement('canvas')
	canvas.width = W
	canvas.height = H
	const ctx = canvas.getContext('2d')

	ctx.fillStyle = '#ffffff'
	ctx.fillRect(0, 0, W, H)

	ctx.fillStyle = carrier.primary
	ctx.fillRect(0, 0, W, 44)
	ctx.fillStyle = carrier.secondary
	ctx.fillRect(0, 44, W, 4)

	ctx.fillStyle = carrier.text
	ctx.font = 'bold 28px Arial, sans-serif'
	ctx.fillText(carrier.name, 12, 32)

	ctx.fillStyle = '#666'
	ctx.font = 'bold 11px Arial'
	ctx.fillText('TO:', 12, 68)

	ctx.fillStyle = '#000'
	ctx.font = 'bold 22px Arial'
	const name = recipient.length > 18 ? recipient.slice(0, 17) + '…' : recipient
	ctx.fillText(name, 12, 94)

	ctx.fillStyle = '#888'
	ctx.font = '10px monospace'
	ctx.fillText(_trackingNumber(carrier, bucket), 12, 112)

	const seed = Math.abs(_hash(bucket * 7 + 3))
	for (let i = 0, x = 12; x < W - 12; i++) {
		const w = 1 + ((seed >>> (i % 28)) & 3)
		const gap = 1 + ((seed >>> ((i + 5) % 28)) & 2)
		ctx.fillStyle = (i & 1) ? '#000' : '#fff'
		ctx.fillRect(x, 124, w, 50)
		x += w + gap
	}

	ctx.fillStyle = '#999'
	ctx.font = 'italic 9px Arial'
	ctx.fillText(carrier.tagline, 12, 184)

	const tex = new THREE.CanvasTexture(canvas)
	tex.colorSpace      = THREE.SRGBColorSpace
	tex.generateMipmaps = false
	tex.minFilter       = THREE.LinearFilter
	tex.needsUpdate     = true
	return tex
}

function _trackingNumber (carrier, bucket) {
	const h = Math.abs(_hash(bucket * 13 + carrier.id.length))
	const tail = h.toString(36).toUpperCase().padStart(8, '0').slice(-8)
	return `${carrier.id.slice(0, 2).toUpperCase()} ${tail.slice(0, 4)} ${tail.slice(4)}`
}
