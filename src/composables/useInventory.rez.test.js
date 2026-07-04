import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { C } from '@shared/protocol.js'

const emitSpy = vi.fn()
vi.mock('@/composables/useRealtimeSocket', () => ({
	useRealtimeSocket: () => ({ on: vi.fn(), off: vi.fn(), emit: emitSpy }),
}))
vi.mock('@/composables/useLLUDP', () => ({
	useLLUDP: () => ({ purgeInventoryFolder: vi.fn() }),
}))
vi.mock('@/composables/useAudio', () => ({ playSound: vi.fn() }))

import { rezPositionInFront, ASSET_TYPE_OBJECT, useInventory } from '@/composables/useInventory'
import { useInventoryStore } from '@/stores/inventoryStore'
import { useNotificationStore } from '@/stores/notificationStore'

// Pure position math for the "Rez in world" default drop point (~2m in front of the avatar).
// Forward basis matches useWorldEngine.js camAt: [-sin(yaw), cos(yaw), 0] in SL space.
describe('rezPositionInFront', () => {
	const AV = { x: 128, y: 128, z: 25 }

	it('yaw 0 (facing North / SL +Y) rezzes 2m north at avatar height', () => {
		const p = rezPositionInFront(AV, 0, 2)
		expect(p.x).toBeCloseTo(128, 5)     // -sin(0)=0 → no X shift
		expect(p.y).toBeCloseTo(130, 5)     //  cos(0)=1 → +2 north
		expect(p.z).toBe(25)                // avatar height unchanged
	})

	it('yaw +90° (facing West / SL -X) rezzes 2m west', () => {
		const p = rezPositionInFront(AV, Math.PI / 2, 2)
		expect(p.x).toBeCloseTo(126, 5)     // -sin(90°)=-1 → -2 X
		expect(p.y).toBeCloseTo(128, 5)     //  cos(90°)=0 → no Y shift
	})

	it('default distance is 2m', () => {
		const p = rezPositionInFront(AV, 0)
		expect(p.y).toBeCloseTo(130, 5)
	})

	it('custom distance scales the offset', () => {
		const p = rezPositionInFront(AV, 0, 5)
		expect(p.y).toBeCloseTo(133, 5)
	})

	it('clamps negative coords to 0 (never rez outside region min edge)', () => {
		const p = rezPositionInFront({ x: 1, y: 1, z: 0 }, Math.PI / 2, 2)   // -2 in X → -1
		expect(p.x).toBe(0)
		expect(p.z).toBe(0)
	})

	it('falls back to region centre when avatarPos is missing', () => {
		const p = rezPositionInFront(null, 0, 0)
		expect(p).toEqual({ x: 128, y: 128, z: 25 })
	})

	it('exports OBJECT asset type = 6 (SL rezzable object)', () => {
		expect(ASSET_TYPE_OBJECT).toBe(6)
	})
})

// rezObject wire contract: perm masks + flags must pass through VERBATIM from the item record —
// never recomputed. OpenSim derives the rezzed perms from the inventory-SERVICE row
// (InventoryAccessModule.cs:1151-1301 DoPreRezWhenFromItem), so a client that recomputed masks
// here would poison nothing sim-side, but the same fields feed UpdateInventoryItem writes, where
// recompute WOULD corrupt the service row (the rez-perm-loss root cause hunt, 2026-07-03).
describe('rezObject emit payload', () => {
	// Distinctive masks incl. FOLDED low bits (0x0F) in baseMask and ObjectSlamPerm (0x100) in
	// flags — exactly the bits that, if stripped/recomputed, cause Move-only perms on rez.
	const OBJ = {
		itemId: 'obj-1', name: 'Box', desc: 'a box', assetType: 6, invType: 6,
		flags: 0x00000100, createdAt: 1700000000,
		baseMask: 0x0008E00F, ownerMask: 0x0008E000, groupMask: 0x00002000,
		everyoneMask: 0x00008000, nextOwnerMask: 0x0008A000,
	}
	const NOCOPY = { ...OBJ, itemId: 'obj-nc', name: 'NoCopy', ownerMask: 0x00086000 }
	const NOTOBJ = { ...OBJ, itemId: 'note-1', name: 'Note', assetType: 7 }
	let rez, notif
	const rezEmits = () => emitSpy.mock.calls.filter(([msg]) => msg === C.REZ_OBJECT)

	beforeEach(() => {
		setActivePinia(createPinia())
		emitSpy.mockClear()
		const inv = useInventoryStore()
		inv.items.set('folder-1', [OBJ, NOCOPY, NOTOBJ])
		notif = useNotificationStore()
		rez = useInventory().rezObject
	})

	it('emits masks + flags VERBATIM from the item record (folded base bits + slam flag intact)', () => {
		rez('obj-1', { x: 1, y: 2, z: 3 })
		const calls = rezEmits()
		expect(calls.length).toBe(1)
		const d = calls[0][1]
		expect(d.itemId).toBe('obj-1')
		expect(d.folderId).toBe('folder-1')
		expect(d.position).toEqual({ x: 1, y: 2, z: 3 })
		expect(d.baseMask).toBe(0x0008E00F)
		expect(d.ownerMask).toBe(0x0008E000)
		expect(d.groupMask).toBe(0x00002000)
		expect(d.everyoneMask).toBe(0x00008000)
		expect(d.nextOwnerMask).toBe(0x0008A000)
		expect(d.flags).toBe(0x00000100)
		expect(d.name).toBe('Box')
		expect(d.description).toBe('a box')
	})

	it('removeItem derives ONLY from ownerMask & PERM_COPY: copyable → false', () => {
		rez('obj-1', { x: 1, y: 2, z: 3 })
		expect(rezEmits()[0][1].removeItem).toBe(false)
	})

	it('removeItem: no-copy item → true (consumed on rez, FS remove_from_inventory)', () => {
		rez('obj-nc', { x: 1, y: 2, z: 3 })
		expect(rezEmits()[0][1].removeItem).toBe(true)
	})

	it('default placement: no ray fields set (server packs BypassRaycast=1 + RayTargetID=ZERO)', () => {
		rez('obj-1', { x: 1, y: 2, z: 3 })
		const d = rezEmits()[0][1]
		expect(d.rayStart).toBeUndefined()
		expect(d.rayTargetId).toBeUndefined()
		expect(d.bypassRaycast).toBeUndefined()
	})

	it('opts passthrough: rayStart / rayTargetId / bypassRaycast reach the emit unchanged', () => {
		rez('obj-1', { x: 4, y: 5, z: 6 }, {
			rayStart: { x: 1, y: 2, z: 30 }, rayTargetId: 'aaaa-bbbb', bypassRaycast: false,
		})
		const d = rezEmits()[0][1]
		expect(d.rayStart).toEqual({ x: 1, y: 2, z: 30 })
		expect(d.rayTargetId).toBe('aaaa-bbbb')
		expect(d.bypassRaycast).toBe(false)
	})

	it('non-object asset type → zero emits + one "Not rezzable" toast', () => {
		rez('note-1', { x: 1, y: 2, z: 3 })
		expect(rezEmits().length).toBe(0)
		expect(notif.toasts.length).toBe(1)
		expect(notif.toasts[0].title).toBe('Not rezzable')
	})
})
