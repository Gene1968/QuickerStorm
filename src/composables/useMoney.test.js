// src/composables/useMoney.test.js — pure-logic tests: affordability gate, buy title selection,
// pay transaction-type selection. Mirrors the FS reference cited in useMoney.js's comments.
import { describe, it, expect } from 'vitest'
import { canAfford, buyTitleFor, transactionTypeForKind, PAY_PRESETS } from './useMoney.js'

const TRANS = { GIFT: 5001, PAY_OBJECT: 5008 }

describe('canAfford', () => {
	it('free (price <= 0) always affordable regardless of balance', () => {
		expect(canAfford(0, 0)).toBe(true)
		expect(canAfford(0, null)).toBe(true)
		expect(canAfford(-5, 0)).toBe(true)
	})

	it('unknown balance (null) never blocks a priced buy', () => {
		expect(canAfford(500, null)).toBe(true)
	})

	it('known balance blocks a priced buy that exceeds it', () => {
		expect(canAfford(500, 100)).toBe(false)
	})

	it('known balance allows a priced buy at or under it', () => {
		expect(canAfford(100, 100)).toBe(true)
		expect(canAfford(50, 100)).toBe(true)
	})

	it('coerces non-numeric price to 0 (treated as free)', () => {
		expect(canAfford(undefined, 0)).toBe(true)
		expect(canAfford(NaN, 0)).toBe(true)
	})
})

describe('buyTitleFor', () => {
	it('saleType 2 (Copy) -> "Buy Copy of X"', () => {
		expect(buyTitleFor(2, 'Chair')).toBe('Buy Copy of Chair')
	})

	it('saleType 3 (Contents) -> "Buy Contents of X"', () => {
		expect(buyTitleFor(3, 'Vendor')).toBe('Buy Contents of Vendor')
	})

	it('saleType 1 (Original) -> "Buy X"', () => {
		expect(buyTitleFor(1, 'Table')).toBe('Buy Table')
	})

	it('unknown/undefined saleType falls back to "Buy X"', () => {
		expect(buyTitleFor(undefined, 'Thing')).toBe('Buy Thing')
		expect(buyTitleFor(0, 'Thing')).toBe('Buy Thing')
	})

	it('missing name falls back to "Object"', () => {
		expect(buyTitleFor(2, '')).toBe('Buy Copy of Object')
		expect(buyTitleFor(1, null)).toBe('Buy Object')
	})
})

describe('transactionTypeForKind', () => {
	it('objects pay via TRANS_PAY_OBJECT', () => {
		expect(transactionTypeForKind('object', TRANS)).toBe(TRANS.PAY_OBJECT)
	})

	it('avatars pay via TRANS_GIFT', () => {
		expect(transactionTypeForKind('avatar', TRANS)).toBe(TRANS.GIFT)
	})

	it('groups pay via TRANS_GIFT', () => {
		expect(transactionTypeForKind('group', TRANS)).toBe(TRANS.GIFT)
	})
})

describe('PAY_PRESETS', () => {
	it('matches the FS fast-pay buttons L$1/5/10/20', () => {
		expect(PAY_PRESETS).toEqual([1, 5, 10, 20])
	})
})
