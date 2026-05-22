import * as THREE from "three"
import { gsap } from "gsap"

/**
 * Wraps a door Object3D in a pivot Group so it rotates around an off-center hinge,
 * mirroring the LSL smooth-hinge-door pattern by Lyn Mimistrobell.
 *
 * LSL → Three.js coordinate conversion (Blender GLTF Y-up export):
 *   LSL <x, y, z>  →  Three.js { x, y: z, z: -y }
 *
 * @param {THREE.Object3D} door
 * @param {object}  opts
 * @param {{ x?: number, y?: number, z?: number }} opts.hingeOffset
 *   Offset from door's current position to the hinge center, in the door's parent space.
 *   This keeps the hinge point world-fixed while the door rotates (matches LSL formula:
 *   `hingePosition = positionClosed + HINGE_POSITION * rotationClosed`).
 * @param {number}         opts.openAngle  Open angle in radians (negative flips direction).
 * @param {'x'|'y'|'z'}  [opts.axis='y']  Pivot rotation axis.
 * @param {number}        [opts.duration=0.8]  Seconds to open/close.
 * @param {number}        [opts.autoClose=0]   Auto-close delay in seconds; 0 = disabled.
 * @returns {{ pivot: THREE.Group, open: Function, close: Function, toggle: Function, isOpen: () => boolean }}
 */
export function createHingeDoor (door, opts) {
	const {
		hingeOffset = {},
		openAngle,
		axis = "y",
		duration = 0.8,
		autoClose = 0,
		onOpen = null,
		onClose = null,
	} = opts

	// Decompose baked matrix so position/quaternion/scale are readable
	if (!door.matrixAutoUpdate) {
		door.matrix.decompose(door.position, door.quaternion, door.scale)
		door.matrixAutoUpdate = true
	}

	const hinge = new THREE.Vector3(hingeOffset.x ?? 0, hingeOffset.y ?? 0, hingeOffset.z ?? 0)

	// Pivot lives at (door.position + hingeOffset) in parent space
	const pivot = new THREE.Group()
	const parent = door.parent
	pivot.position.copy(door.position).add(hinge)

	// Re-parent door under pivot; adjust door position to be relative to pivot
	parent.remove(door)
	pivot.add(door)
	parent.add(pivot)
	door.position.set(-hinge.x, -hinge.y, -hinge.z)

	let _open = false
	let _timer = null

	function open () {
		if (_open) return
		_open = true
		if (onOpen) onOpen()
		gsap.to(pivot.rotation, { [axis]: openAngle, duration, ease: "power2.inOut" })
		if (autoClose > 0) {
			clearTimeout(_timer)
			_timer = setTimeout(close, autoClose * 1000)
		}
	}

	function close () {
		if (!_open) return
		_open = false
		clearTimeout(_timer)
		gsap.to(pivot.rotation, {
			[axis]: 0, duration, ease: "power2.inOut",
			onComplete: () => { if (onClose) onClose() },
		})
	}

	function toggle () {
		_open ? close() : open()
	}

	// Silent variants for remote state sync — no sound callbacks, no auto-close timer.
	function openSilent () {
		if (_open) return
		_open = true
		gsap.to(pivot.rotation, { [axis]: openAngle, duration, ease: "power2.inOut" })
	}

	function closeSilent () {
		if (!_open) return
		_open = false
		gsap.to(pivot.rotation, { [axis]: 0, duration, ease: "power2.inOut" })
	}

	return { pivot, open, close, toggle, isOpen: () => _open, openSilent, closeSilent }
}
