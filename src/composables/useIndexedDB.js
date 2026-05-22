/**
 * useIndexedDB — lightweight wrapper around IDB for persistent
 * key/value storage across sessions.
 */
import { openDB } from 'idb'

const DB_NAME = 'quickerSTORM'
const DB_VERSION = 1
const STORE_NAME = 'kv'

let dbPromise = null

function getDb() {
	if (!dbPromise) {
		dbPromise = openDB(DB_NAME, DB_VERSION, {
			upgrade(db) {
				if (!db.objectStoreNames.contains(STORE_NAME)) {
					db.createObjectStore(STORE_NAME)
				}
			},
		})
	}
	return dbPromise
}

export function useIndexedDB() {
	async function get(key) {
		const db = await getDb()
		return db.get(STORE_NAME, key)
	}

	async function set(key, value) {
		const db = await getDb()
		return db.put(STORE_NAME, value, key)
	}

	async function del(key) {
		const db = await getDb()
		return db.delete(STORE_NAME, key)
	}

	async function clear() {
		const db = await getDb()
		return db.clear(STORE_NAME)
	}

	async function keys() {
		const db = await getDb()
		return db.getAllKeys(STORE_NAME)
	}

	return { get, set, del, clear, keys }
}
