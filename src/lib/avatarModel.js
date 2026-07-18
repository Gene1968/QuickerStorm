// src/lib/avatarModel.js — shared rigged-humanoid GLB used as the "jellydoll" avatar placeholder.
//
// WHY: our only avatar representation was a tinted capsule ("tube"). FS renders too-complex / not-yet-
// resolved avatars as the base SYSTEM AVATAR humanoid painted a solid muted color (a "jellydoll"). We
// mirror that intent with one shared low-poly rigged humanoid (avatar-default.glb: 67-bone
// skeleton, KHR_mesh_quantization — decoded natively by GLTFLoader — plus 11 baked clips incl.
// Idle_Loop / Walk_Loop). The model is loaded ONCE and cloned per avatar (SkeletonUtils.clone, required
// for skinned meshes), tinted per-UUID, and scaled to the SL default visible height. No shape/skin/
// attachment decode needed — this is the cohesive placeholder that lets us retire the scattered look.
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import glbUrl from '@/assets/3d/avatar-default.glb?url'

// Match the placeholder capsule / SL-FS default visible avatar height (see AVATAR_CAP_* in useWorldEngine).
export const AVATAR_MODEL_HEIGHT = 1.8

let _loadPromise = null
let _template = null   // { scene, clips, baseScale, footOffsetScaled }

/** Load + parse the shared avatar GLB once. Resolves to the template (cached). */
export function loadAvatarModel() {
	if (_loadPromise) return _loadPromise
	_loadPromise = new Promise((resolve, reject) => {
		new GLTFLoader().load(
			glbUrl,
			(gltf) => {
				const scene = gltf.scene
				// Native bbox → uniform scale to hit AVATAR_MODEL_HEIGHT; capture the (scaled) foot plane
				// so createAvatarModel can drop the feet onto the wrapper origin (same contract as
				// placeRiggedAttachment: origin = feet, parent lifts by −RIG_FOOT_OFFSET).
				const box = new THREE.Box3().setFromObject(scene)
				const size = new THREE.Vector3(); box.getSize(size)
				const baseScale = size.y > 0 ? AVATAR_MODEL_HEIGHT / size.y : 1
				_template = { scene, clips: gltf.animations || [], baseScale, footOffsetScaled: box.min.y * baseScale }
				resolve(_template)
			},
			undefined,
			(err) => { _loadPromise = null; reject(err) },
		)
	})
	return _loadPromise
}

/**
 * Clone the loaded humanoid for one avatar. Returns null if not loaded yet.
 * @returns {{ root: THREE.Group, clips: THREE.AnimationClip[], mats: THREE.Material[] }}
 *   root — wrapper whose LOCAL origin is the feet plane (parent at −RIG_FOOT_OFFSET, like rigged attachments).
 *   mats — per-clone flat materials to tint per-UUID (jellydoll) via applyAvatarLook.
 */
export function createAvatarModel() {
	if (!_template) return null
	const wrapper = new THREE.Group()
	const model = cloneSkinned(_template.scene)
	model.scale.setScalar(_template.baseScale)
	model.position.y = -_template.footOffsetScaled   // feet → wrapper origin
	wrapper.add(model)

	// Replace the GLB's material with a flat per-UUID "jellydoll" material (honest placeholder:
	// we don't know their real skin). MeshStandard so the humanoid form reads under scene lights;
	// an emissive floor keeps it visible even if lighting is weak. applyAvatarLook drives color/opacity.
	const mats = []
	model.traverse((o) => {
		if (o.isMesh || o.isSkinnedMesh) {
			o.frustumCulled = false   // skinned-mesh bounds are unreliable; never cull the placeholder
			o.castShadow = false
			o.material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0, emissive: 0x000000 })
			mats.push(o.material)
		}
	})
	return { root: wrapper, clips: _template.clips, mats }
}
