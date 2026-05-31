import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAccountsStore } from '@/stores/accountsStore'

beforeEach(() => {
	setActivePinia(createPinia())
	localStorage.clear()
})

describe('accountsStore', () => {
	it('starts with empty accounts', () => {
		const store = useAccountsStore()
		expect(store.accounts).toEqual([])
	})

	it('addOrUpdate adds an account', () => {
		const store = useAccountsStore()
		store.addOrUpdate('Gene Freenote', 'osgrid', 'secret')
		expect(store.accounts).toHaveLength(1)
		expect(store.accounts[0].username).toBe('Gene Freenote')
		expect(store.accounts[0].gridNick).toBe('osgrid')
	})

	it('addOrUpdate updates existing account (case-insensitive username)', () => {
		const store = useAccountsStore()
		store.addOrUpdate('Gene Freenote', 'osgrid', 'old')
		store.addOrUpdate('gene freenote', 'osgrid', 'new')
		expect(store.accounts).toHaveLength(1)
		expect(store.accounts[0].password).toBe('new')
	})

	it('same username on different grids = two entries', () => {
		const store = useAccountsStore()
		store.addOrUpdate('Gene Freenote', 'osgrid', 'pass1')
		store.addOrUpdate('Gene Freenote', 'agni', 'pass2')
		expect(store.accounts).toHaveLength(2)
	})

	it('getPassword returns password for known account', () => {
		const store = useAccountsStore()
		store.addOrUpdate('Gene Freenote', 'osgrid', 'mypass')
		expect(store.getPassword('Gene Freenote', 'osgrid')).toBe('mypass')
	})

	it('getPassword is case-insensitive on username', () => {
		const store = useAccountsStore()
		store.addOrUpdate('Gene Freenote', 'osgrid', 'mypass')
		expect(store.getPassword('GENE FREENOTE', 'osgrid')).toBe('mypass')
	})

	it('getPassword returns null for unknown account', () => {
		const store = useAccountsStore()
		expect(store.getPassword('Nobody', 'osgrid')).toBeNull()
	})

	it('remove deletes matching account', () => {
		const store = useAccountsStore()
		store.addOrUpdate('Gene Freenote', 'osgrid', 'pass')
		store.remove('Gene Freenote', 'osgrid')
		expect(store.accounts).toHaveLength(0)
	})

	it('remove leaves other accounts intact', () => {
		const store = useAccountsStore()
		store.addOrUpdate('Gene Freenote', 'osgrid', 'pass1')
		store.addOrUpdate('Gene Freenote', 'agni', 'pass2')
		store.remove('Gene Freenote', 'osgrid')
		expect(store.accounts).toHaveLength(1)
		expect(store.accounts[0].gridNick).toBe('agni')
	})

	it('accounts sorted by lastUsed descending', async () => {
		const store = useAccountsStore()
		store.addOrUpdate('Alice', 'osgrid', 'p1')
		await new Promise(r => setTimeout(r, 10))
		store.addOrUpdate('Bob', 'osgrid', 'p2')
		expect(store.accounts[0].username).toBe('Bob')
	})

	it('migrates legacy qs_autologin_* keys on first load', () => {
		localStorage.setItem('qs_autologin_osgrid', JSON.stringify({ username: 'Gene', password: 'old' }))
		const store = useAccountsStore()
		expect(store.accounts.find(a => a.gridNick === 'osgrid')?.username).toBe('Gene')
		expect(localStorage.getItem('qs_autologin_osgrid')).toBeNull()
	})

	it('skips migration if qs_saved_accounts already exists', () => {
		localStorage.setItem('qs_saved_accounts', JSON.stringify([
			{ username: 'Existing', gridNick: 'osgrid', password: 'x', lastUsed: 1 },
		]))
		localStorage.setItem('qs_autologin_osgrid', JSON.stringify({ username: 'Legacy', password: 'old' }))
		const store = useAccountsStore()
		expect(store.accounts.find(a => a.username === 'Legacy')).toBeUndefined()
	})

	it('persists accounts across store instances', () => {
		const s1 = useAccountsStore()
		s1.addOrUpdate('Gene Freenote', 'osgrid', 'pass')
		// Simulate a new store instance reading from localStorage
		setActivePinia(createPinia())
		const s2 = useAccountsStore()
		expect(s2.accounts.find(a => a.gridNick === 'osgrid')?.username).toBe('Gene Freenote')
	})

	it('filters out accounts for unknown/deleted grids', () => {
		const store = useAccountsStore()
		store.addOrUpdate('Ghost', 'unknown-grid-xyz', 'pass')
		expect(store.accounts).toHaveLength(0)
	})
})
