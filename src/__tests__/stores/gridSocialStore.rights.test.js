import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import {
	useGridSocialStore, hasRight, setRight,
	RIGHT_ONLINE, RIGHT_MAP, RIGHT_MODIFY,
} from '@/stores/gridSocialStore'

beforeEach(() => setActivePinia(createPinia()))

describe('rights bit helpers', () => {
	it('hasRight reads a bit', () => {
		expect(hasRight(RIGHT_ONLINE | RIGHT_MAP, RIGHT_MAP)).toBe(true)
		expect(hasRight(RIGHT_ONLINE, RIGHT_MODIFY)).toBe(false)
	})
	it('setRight toggles a bit without disturbing others', () => {
		expect(setRight(RIGHT_ONLINE, RIGHT_MAP, true)).toBe(RIGHT_ONLINE | RIGHT_MAP)
		expect(setRight(RIGHT_ONLINE | RIGHT_MAP, RIGHT_MAP, false)).toBe(RIGHT_ONLINE)
	})
})

describe('addFriend', () => {
	it('inserts a new friend (lowercased id) and is idempotent', () => {
		const s = useGridSocialStore()
		s.addFriend('ABC-123', 'Bob Linden')
		s.addFriend('abc-123', 'Bob Linden')
		expect(s.friends.length).toBe(1)
		expect(s.friends[0]).toMatchObject({ id: 'abc-123', name: 'Bob Linden', rightsGiven: 0, rightsHas: 0 })
	})
})

describe('applyRightsChange / setRightsGivenLocal', () => {
	it('patches rightsGiven / rightsHas only where provided', () => {
		const s = useGridSocialStore()
		s.addFriend('x', 'X', 1, 2)
		s.applyRightsChange({ agentId: 'x', rightsGiven: 7 })
		expect(s.friendById('x')).toMatchObject({ rightsGiven: 7, rightsHas: 2 })
		s.applyRightsChange({ agentId: 'x', rightsHas: 4 })
		expect(s.friendById('x')).toMatchObject({ rightsGiven: 7, rightsHas: 4 })
	})
	it('setRightsGivenLocal sets rightsGiven optimistically', () => {
		const s = useGridSocialStore()
		s.addFriend('y', 'Y')
		s.setRightsGivenLocal('y', 3)
		expect(s.friendById('y').rightsGiven).toBe(3)
	})
})
