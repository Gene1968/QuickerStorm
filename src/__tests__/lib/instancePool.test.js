// src/__tests__/lib/instancePool.test.js
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { createInstancePool } from '@/lib/instancePool.js'

const m4 = (x) => new THREE.Matrix4().setPosition(x, 0, 0)
const factory = () => ({ geometry: new THREE.BoxGeometry(1, 1, 1), material: new THREE.MeshBasicMaterial() })

describe('instancePool', () => {
	it('adds instances and exposes one InstancedMesh per pool key', () => {
		const scene = new THREE.Scene()
		const pool = createInstancePool(scene)
		pool.add('K', factory, m4(0), null, 100)
		pool.add('K', factory, m4(1), null, 101)
		expect(pool.meshes()).toHaveLength(1)
		expect(pool.meshes()[0].count).toBe(2)
		expect(scene.children).toContain(pool.meshes()[0])
	})

	it('pick maps (mesh, instanceId) back to localId', () => {
		const scene = new THREE.Scene()
		const pool = createInstancePool(scene)
		pool.add('K', factory, m4(0), null, 100)
		pool.add('K', factory, m4(1), null, 101)
		const im = pool.meshes()[0]
		expect(pool.pick(im, 0)).toBe(100)
		expect(pool.pick(im, 1)).toBe(101)
	})

	it('swap-remove keeps remaining instances pickable', () => {
		const scene = new THREE.Scene()
		const pool = createInstancePool(scene)
		pool.add('K', factory, m4(0), null, 100)
		pool.add('K', factory, m4(1), null, 101)
		pool.add('K', factory, m4(2), null, 102)
		pool.remove(101)                       // middle
		const im = pool.meshes()[0]
		expect(im.count).toBe(2)
		expect(pool.has(101)).toBe(false)
		expect(pool.has(100)).toBe(true)
		expect(pool.has(102)).toBe(true)
		// 102 swapped into slot 1
		expect(pool.pick(im, 1)).toBe(102)
	})

	it('grows past initial capacity', () => {
		const scene = new THREE.Scene()
		const pool = createInstancePool(scene, { initialCap: 2 })
		for (let i = 0; i < 5; i++) pool.add('K', factory, m4(i), null, 200 + i)
		const im = pool.meshes()[0]
		expect(im.count).toBe(5)
		for (let i = 0; i < 5; i++) expect(pool.pick(im, i)).toBe(200 + i)
	})

	it('disposes a pool when its last instance leaves', () => {
		const scene = new THREE.Scene()
		const pool = createInstancePool(scene)
		pool.add('K', factory, m4(0), null, 100)
		pool.remove(100)
		expect(pool.meshes()).toHaveLength(0)
		expect(scene.children).toHaveLength(0)
	})

	it('one object across multiple pools is fully removed', () => {
		const scene = new THREE.Scene()
		const pool = createInstancePool(scene)
		pool.add('A', factory, m4(0), null, 100)
		pool.add('B', factory, m4(0), null, 100)   // same object, face 2
		expect(pool.meshes()).toHaveLength(2)
		pool.remove(100)
		expect(pool.meshes()).toHaveLength(0)
		expect(pool.has(100)).toBe(false)
	})

	it('bytes counts geometry once per pool', () => {
		const scene = new THREE.Scene()
		const pool = createInstancePool(scene)
		pool.add('K', factory, m4(0), null, 100)
		pool.add('K', factory, m4(1), null, 101)
		expect(pool.bytes()).toBeGreaterThan(0)
	})
})
