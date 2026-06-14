// src/lib/instancePool.js
import * as THREE from 'three'

// Manages the set of InstancedMesh objects that render pooled (repeated) geometry.
// poolKey = `${geomKey}::${materialIndex}::${materialKey}`. The caller supplies a
// factory() → {geometry, material} used ONCE when a pool is first created (so this
// module stays ignorant of textures/caches). One object may join several pools (one
// per face-part); remove(localId) cleans up every pool it joined.
// See spec draw-call-instancing.
const INITIAL_CAP = 16

export function createInstancePool(scene, opts = {}) {
	const initialCap = opts.initialCap ?? INITIAL_CAP
	const pools = new Map()          // poolKey → { im, cap, count, idAt:[], slotOf:Map }
	const objPools = new Map()       // localId → poolKey[]
	const _m = new THREE.Matrix4()
	const _c = new THREE.Color()

	function createPool(poolKey, factory) {
		const { geometry, material } = factory()
		const im = new THREE.InstancedMesh(geometry, material, initialCap)
		im.count = 0
		im.frustumCulled = false       // pools group by key, not location; instanced submit is cheap
		const pool = { im, cap: initialCap, count: 0, idAt: [], slotOf: new Map() }
		im.userData.qsPool = pool
		im.userData.qsInstanced = true
		pools.set(poolKey, pool)
		scene.add(im)
		return pool
	}

	function grow(pool) {
		const newCap = pool.cap * 2
		const old = pool.im
		const im = new THREE.InstancedMesh(old.geometry, old.material, newCap)
		im.count = pool.count
		im.frustumCulled = false
		im.userData.qsPool = pool
		im.userData.qsInstanced = true
		for (let i = 0; i < pool.count; i++) {
			old.getMatrixAt(i, _m); im.setMatrixAt(i, _m)
			if (old.instanceColor) { old.getColorAt(i, _c); im.setColorAt(i, _c) }
		}
		im.instanceMatrix.needsUpdate = true
		if (im.instanceColor) im.instanceColor.needsUpdate = true
		scene.remove(old)
		// do NOT dispose geometry/material — reused by the new InstancedMesh
		old.dispose()
		scene.add(im)
		pool.im = im
		pool.cap = newCap
	}

	function add(poolKey, factory, matrix, color, localId) {
		let pool = pools.get(poolKey)
		if (!pool) pool = createPool(poolKey, factory)
		if (pool.count >= pool.cap) grow(pool)
		const slot = pool.count++
		pool.im.setMatrixAt(slot, matrix)
		pool.im.instanceMatrix.needsUpdate = true
		if (color) {
			pool.im.setColorAt(slot, color)
			pool.im.instanceColor.needsUpdate = true
		}
		pool.im.count = pool.count
		pool.idAt[slot] = localId
		pool.slotOf.set(localId, slot)
		let keys = objPools.get(localId)
		if (!keys) { keys = []; objPools.set(localId, keys) }
		keys.push(poolKey)
	}

	function removeFromPool(poolKey, localId) {
		const pool = pools.get(poolKey)
		if (!pool) return
		const slot = pool.slotOf.get(localId)
		if (slot === undefined) return
		const last = pool.count - 1
		if (slot !== last) {
			pool.im.getMatrixAt(last, _m); pool.im.setMatrixAt(slot, _m)
			if (pool.im.instanceColor) { pool.im.getColorAt(last, _c); pool.im.setColorAt(slot, _c) }
			const movedId = pool.idAt[last]
			pool.idAt[slot] = movedId
			pool.slotOf.set(movedId, slot)
		}
		pool.count--
		pool.im.count = pool.count
		pool.im.instanceMatrix.needsUpdate = true
		if (pool.im.instanceColor) pool.im.instanceColor.needsUpdate = true
		pool.idAt.length = pool.count
		pool.slotOf.delete(localId)
		if (pool.count === 0) {
			scene.remove(pool.im)
			pool.im.geometry.dispose()
			const mat = pool.im.material
			if (Array.isArray(mat)) mat.forEach(m => m.dispose?.()); else mat.dispose?.()
			pool.im.dispose()
			pools.delete(poolKey)
		}
	}

	function remove(localId) {
		const keys = objPools.get(localId)
		if (!keys) return
		for (const k of keys) removeFromPool(k, localId)
		objPools.delete(localId)
	}

	function pick(instancedMesh, instanceId) {
		const pool = instancedMesh?.userData?.qsPool
		return pool ? (pool.idAt[instanceId] ?? null) : null
	}

	function has(localId) { return objPools.has(localId) }
	function meshes() { return [...pools.values()].map(p => p.im) }

	function bytes() {
		let b = 0
		for (const p of pools.values()) {
			const g = p.im.geometry
			for (const a of Object.values(g.attributes || {})) b += a.array?.byteLength || 0
			b += g.index?.array?.byteLength || 0
			b += p.im.instanceMatrix?.array?.byteLength || 0
			b += p.im.instanceColor?.array?.byteLength || 0
		}
		return b
	}

	function dispose() {
		for (const p of pools.values()) {
			scene.remove(p.im)
			p.im.geometry.dispose()
			const mat = p.im.material
			if (Array.isArray(mat)) mat.forEach(m => m.dispose?.()); else mat.dispose?.()
			p.im.dispose()
		}
		pools.clear()
		objPools.clear()
	}

	return { add, remove, pick, has, meshes, bytes, dispose }
}
