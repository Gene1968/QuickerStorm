// src/__tests__/stores/inventoryStore.dataloss.test.js — MOVE-RECONCILIATION STATE MACHINE.
// WHY: items the user CREATED or MOVED into a folder must survive a lagging grid re-fetch (setItems)
// that would otherwise drop or duplicate them before the grid write-back lands, and the cache-save then
// persists the loss. A naïve per-item dirty BOOLEAN (cleared on the first fetch that saw the item) had
// two correctness bugs these tests pin against:
//   BUG A (duplicate): DST fetch INCLUDES X (clears dirty) → later lagging SRC fetch still lists X →
//                      nothing suppresses X → X ends up in BOTH SRC and DST.
//   BUG B (stuck):     the grid NEVER performs the move → DST never lists X, SRC keeps listing X → X is
//                      pinned to DST forever, hidden from SRC across reloads, no clear path.
// The state machine tracks a pending record per moved/created item, accrues authoritative presence from
// EACH src/dst fetch, and only clears the record once the fetches decide SUCCESS / FAILED / DELETED.
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useInventoryStore } from '@/stores/inventoryStore'
import {
	saveCachedInventory, loadCachedInventory, clearCachedInventory,
	makeInvSavePairs,
} from '@/lib/inventoryCache.js'

const ROOT = 'root-0000'
const SRC  = 'src-folder-0001'
const DST  = 'dst-folder-0001'
const THIRD = 'third-folder-0001'
const AGENT = '00000000-0000-0000-0000-0000000000aa'

const item = (id, name, parentId) => ({
	itemId: id, parentId, name, assetType: 0, invType: 0, assetId: 'asset-0001',
	flags: 0, createdAt: 1700000000, ownerMask: 0xE000,
})

function login(store) {
	store.loadFromLogin({
		inventoryRoot: ROOT,
		inventorySkeleton: [
			{ folderId: ROOT,  parentId: '0',  name: 'My Inventory', typeDefault: 8 },
			{ folderId: SRC,   parentId: ROOT, name: 'Src',          typeDefault: -1 },
			{ folderId: DST,   parentId: ROOT, name: 'Dst',          typeDefault: -1 },
			{ folderId: THIRD, parentId: ROOT, name: 'Third',        typeDefault: -1 },
		],
	})
}

const inFolder = (s, folderId, id) => s.folderItems(folderId).some(i => i.itemId === id)

beforeEach(() => setActivePinia(createPinia()))

// ── Scenario 1: moved-in item survives a lagging DST fetch that omits it (no loss). ──
describe('state machine — moved-IN item survives a lagging DST fetch that omits it', () => {
	it('re-adds a pending moved-in item that the DST fetch omits, then confirms once src is clean', () => {
		const s = useInventoryStore()
		login(s)
		s.setItems(SRC, [item('X', 'Cube', SRC)])
		s.setItems(DST, [])
		s.moveItemLocal('X', DST)
		expect(inFolder(s, DST, 'X')).toBe(true)
		expect(s.folderItems(DST).find(i => i.itemId === 'X').pendingMove).toBeTruthy()

		// A mid-sync re-fetch of DST returns WITHOUT X (grid write-back lagged) — X must survive at DST.
		s.setItems(DST, [])
		expect(inFolder(s, DST, 'X')).toBe(true)
		expect(s.folderItems(DST).find(i => i.itemId === 'X').pendingMove).toBeTruthy()

		// The grid catches up: DST fetch now INCLUDES X (SUCCESS), then SRC fetch confirms clean → record
		// clears and the row becomes authoritative (stamp stripped).
		s.setItems(DST, [item('X', 'Cube', DST)])
		s.setItems(SRC, [])
		const confirmed = s.folderItems(DST).find(i => i.itemId === 'X')
		expect(confirmed).toBeTruthy()
		expect(confirmed.pendingMove).toBeUndefined()
		expect(inFolder(s, SRC, 'X')).toBe(false)
	})
})

// ── Scenario 2 (BUG A): DST fetch INCLUDES X, THEN lagging SRC fetch STILL lists X → no duplicate. ──
describe('state machine — BUG A: success then lagging src fetch does not duplicate', () => {
	it('X ends up in DST only, NOT in SRC, after a success DST fetch and a later stale SRC fetch', () => {
		const s = useInventoryStore()
		login(s)
		s.setItems(SRC, [item('X', 'Cube', SRC)])
		s.setItems(DST, [])
		s.moveItemLocal('X', DST)

		// Authoritative DST fetch INCLUDES X → SUCCESS. Record is HELD (src not yet confirmed clean).
		s.setItems(DST, [item('X', 'Cube', DST)])
		expect(inFolder(s, DST, 'X')).toBe(true)

		// A LAGGING SRC fetch STILL lists X (grid hadn't processed the move when it snapshotted). The held
		// record must SUPPRESS X here — no duplicate. The record STAYS pending (src not yet clean).
		s.setItems(SRC, [item('X', 'Cube', SRC)])
		expect(inFolder(s, SRC, 'X')).toBe(false)
		expect(inFolder(s, DST, 'X')).toBe(true)
		expect(s.folderItems(DST).find(i => i.itemId === 'X').pendingMove).toBeTruthy()   // still held

		// Once a CLEAN SRC fetch arrives (grid processed the move), the record resolves SUCCESS and clears.
		s.setItems(SRC, [])
		expect(inFolder(s, SRC, 'X')).toBe(false)
		expect(inFolder(s, DST, 'X')).toBe(true)
		expect(s.folderItems(DST).find(i => i.itemId === 'X').pendingMove).toBeUndefined()
	})
})

// ── Scenario 3 (BUG B): DST fetched WITHOUT X + SRC fetched WITH X → FAILED → X back in SRC, cleared. ──
describe('state machine — BUG B: move the grid never performed is treated as FAILED', () => {
	it('DST fetched without X and SRC fetched with X → X in SRC, NOT in DST, record cleared', () => {
		const s = useInventoryStore()
		login(s)
		s.setItems(SRC, [item('X', 'Cube', SRC)])
		s.setItems(DST, [])
		s.moveItemLocal('X', DST)
		expect(inFolder(s, DST, 'X')).toBe(true)
		expect(inFolder(s, SRC, 'X')).toBe(false)

		// The grid REJECTED / lost the move. An authoritative DST fetch has NO X, and SRC still legitimately
		// lists X → FAILED → honour the grid: X returns to SRC, removed from DST, record cleared.
		s.setItems(DST, [])
		s.setItems(SRC, [item('X', 'Cube', SRC)])
		expect(inFolder(s, SRC, 'X')).toBe(true)
		expect(inFolder(s, DST, 'X')).toBe(false)
		expect(s.folderItems(SRC).find(i => i.itemId === 'X').pendingMove).toBeUndefined()

		// Not stuck across a reload: persist + reload → X stays in SRC, no pending record resurrects DST.
		const pairs = makeInvSavePairs(s.items)
		const reloaded = useInventoryStore()
		login(reloaded)
		reloaded.applyCachedItems(pairs)
		expect(inFolder(reloaded, SRC, 'X')).toBe(true)
		expect(inFolder(reloaded, DST, 'X')).toBe(false)
	})

	it('FAILED works regardless of fetch order (SRC seen first, then DST without X)', () => {
		const s = useInventoryStore()
		login(s)
		s.setItems(SRC, [item('X', 'Cube', SRC)])
		s.setItems(DST, [])
		s.moveItemLocal('X', DST)
		// SRC fetch (still lists X) arrives BEFORE the DST fetch. Alone it can't decide (dest not fetched).
		s.setItems(SRC, [item('X', 'Cube', SRC)])
		expect(inFolder(s, SRC, 'X')).toBe(false)   // still suppressed — optimistic, undecided
		expect(inFolder(s, DST, 'X')).toBe(true)
		// Now the DST fetch (no X) lands → FAILED → X returns to SRC.
		s.setItems(DST, [])
		expect(inFolder(s, SRC, 'X')).toBe(true)
		expect(inFolder(s, DST, 'X')).toBe(false)
	})
})

// ── Scenario 4 (DELETED): both fetched without X → X removed everywhere, record cleared. ──
describe('state machine — DELETED: item gone server-side is removed everywhere', () => {
	it('DST and SRC both fetched without X → X removed everywhere, record cleared', () => {
		const s = useInventoryStore()
		login(s)
		s.setItems(SRC, [item('X', 'Cube', SRC)])
		s.setItems(DST, [])
		s.moveItemLocal('X', DST)
		// Both authoritative fetches omit X (deleted on the grid between the move and the fetch).
		s.setItems(DST, [])
		s.setItems(SRC, [])
		expect(inFolder(s, DST, 'X')).toBe(false)
		expect(inFolder(s, SRC, 'X')).toBe(false)
		// And it does not resurrect on a later stale fetch (record is gone).
		s.setItems(DST, [])
		expect(inFolder(s, DST, 'X')).toBe(false)
	})
})

// ── Scenario 5: a genuine purge from a fetched folder is NOT resurrected after save+reload. ──
describe('state machine — genuine purge is authoritative and never resurrected', () => {
	it('purge (removeItemLocal) from a fetched folder: a later fetch WITHOUT it keeps it gone', () => {
		const s = useInventoryStore()
		login(s)
		s.setItems(DST, [item('Y', 'DeleteMe', DST)])
		s.removeItemLocal('Y')
		expect(inFolder(s, DST, 'Y')).toBe(false)
		s.setItems(DST, [])
		expect(inFolder(s, DST, 'Y')).toBe(false)
	})

	it('purging a PENDING moved item drops its record so no stale fetch resurrects it', async () => {
		await clearCachedInventory(AGENT)
		const s = useInventoryStore()
		login(s)
		s.setItems(SRC, [item('Z', 'Temp', SRC)])
		s.setItems(DST, [])
		s.moveItemLocal('Z', DST)
		// User purges Z while the move is still pending — record must be dropped.
		s.removeItemLocal('Z')
		expect(inFolder(s, DST, 'Z')).toBe(false)
		// A later stale SRC fetch listing Z must not resurrect it via the state machine.
		s.setItems(SRC, [item('Z', 'Temp', SRC)])
		// SRC fetch is authoritative for SRC (no pending record) → Z legitimately shows where the grid put
		// it. But it must NOT be pinned/hidden nor duplicated into DST.
		expect(inFolder(s, DST, 'Z')).toBe(false)
		// Persist + reload: no pending stamp survives.
		await saveCachedInventory(AGENT, makeInvSavePairs(s.items))
		const loaded = await loadCachedInventory(AGENT)
		const allRows = loaded.itemPairs.flatMap(([, l]) => l)
		expect(allRows.some(r => r.itemId === 'Z' && r.pendingMove)).toBe(false)
	})
})

// ── Scenario 6: created item survives reload when grid omits it; once grid confirms, record clears. ──
describe('state machine — created item survives reload and confirms', () => {
	it('re-adds a pending created item the DST fetch omits, then confirms on a fetch that includes it', () => {
		const s = useInventoryStore()
		login(s)
		s.setItems(DST, [])
		s.addCreatedItems([item('N', 'New Note', DST)])
		expect(s.folderItems(DST).find(i => i.itemId === 'N').pendingMove).toBeTruthy()

		// A lagging re-fetch of DST omits N — it must survive.
		s.setItems(DST, [])
		expect(inFolder(s, DST, 'N')).toBe(true)

		// Grid confirms via a fetch that includes N → success (no src to confirm) → record clears.
		s.setItems(DST, [item('N', 'New Note', DST)])
		const row = s.folderItems(DST).find(i => i.itemId === 'N')
		expect(row.pendingMove).toBeUndefined()
	})

	it('created item survives a persist+reload while the grid still omits it', async () => {
		await clearCachedInventory(AGENT)
		const s = useInventoryStore()
		login(s)
		s.setItems(DST, [])
		s.addCreatedItems([item('N', 'New Note', DST)])
		// Persist (mutation-save) while N is still pending.
		await saveCachedInventory(AGENT, makeInvSavePairs(s.items))

		// Reload: the fresh login has no N; applyCachedItems restores it AND its pending record.
		const reloaded = useInventoryStore()
		login(reloaded)
		const loaded = await loadCachedInventory(AGENT)
		reloaded.applyCachedItems(loaded.itemPairs)
		expect(inFolder(reloaded, DST, 'N')).toBe(true)
		expect(reloaded.folderItems(DST).find(i => i.itemId === 'N').pendingMove).toBeTruthy()

		// A lagging DST fetch that omits N must STILL keep it (record survived the reload).
		reloaded.setItems(DST, [])
		expect(inFolder(reloaded, DST, 'N')).toBe(true)

		// Grid confirms → record clears.
		reloaded.setItems(DST, [item('N', 'New Note', DST)])
		expect(reloaded.folderItems(DST).find(i => i.itemId === 'N').pendingMove).toBeUndefined()
	})
})

// ── Round-trip: a pending MOVE record survives reload and still suppresses a stale SRC fetch (BUG A). ──
describe('state machine — pending MOVE record round-trips through save/reload', () => {
	it('after reload, a still-pending move keeps X at DST and suppresses a lagging SRC fetch', async () => {
		await clearCachedInventory(AGENT)
		const s = useInventoryStore()
		login(s)
		s.setItems(SRC, [item('X', 'Cube', SRC)])
		s.setItems(DST, [])
		s.moveItemLocal('X', DST)
		// Persist while the move is still pending (dest not yet fetched).
		await saveCachedInventory(AGENT, makeInvSavePairs(s.items))

		const reloaded = useInventoryStore()
		login(reloaded)
		const loaded = await loadCachedInventory(AGENT)
		reloaded.applyCachedItems(loaded.itemPairs)
		expect(inFolder(reloaded, DST, 'X')).toBe(true)
		expect(reloaded.folderItems(DST).find(i => i.itemId === 'X').pendingMove).toBeTruthy()

		// Post-reload, a DST fetch confirms X (SUCCESS) — record HELD until src confirmed clean.
		reloaded.setItems(DST, [item('X', 'Cube', DST)])
		// A lagging SRC fetch STILL lists X → suppressed → no duplicate (BUG A protection survived reload).
		reloaded.setItems(SRC, [item('X', 'Cube', SRC)])
		expect(inFolder(reloaded, SRC, 'X')).toBe(false)
		expect(inFolder(reloaded, DST, 'X')).toBe(true)
	})
})

// ── Third-folder invariant: a pending item never appears in a folder that is neither src nor dst. ──
describe('state machine — pending item lives in exactly ONE folder (to)', () => {
	it('drops a pending item that a THIRD folder fetch erroneously lists', () => {
		const s = useInventoryStore()
		login(s)
		s.setItems(SRC, [item('X', 'Cube', SRC)])
		s.setItems(DST, [])
		s.moveItemLocal('X', DST)
		// A stale/erroneous fetch of an unrelated folder lists X — it must not appear there.
		s.setItems(THIRD, [item('X', 'Cube', THIRD)])
		expect(inFolder(s, THIRD, 'X')).toBe(false)
		expect(inFolder(s, DST, 'X')).toBe(true)
	})
})

// ── applyBulkUpdate is authoritative: it retires the pending record. ──
describe('applyBulkUpdate retires the pending record', () => {
	it('an authoritative BulkUpdate for a moved item clears its pending stamp', () => {
		const s = useInventoryStore()
		login(s)
		s.setItems(SRC, [item('X', 'Cube', SRC)])
		s.setItems(DST, [])
		s.moveItemLocal('X', DST)
		expect(s.folderItems(DST).find(i => i.itemId === 'X').pendingMove).toBeTruthy()
		s.applyBulkUpdate({ items: [item('X', 'Cube', DST)] })
		const row = s.folderItems(DST).find(i => i.itemId === 'X')
		expect(row.pendingMove).toBeUndefined()

		// After the BulkUpdate the record is gone: a lagging SRC fetch listing X is authoritative for SRC
		// only (won't be re-suppressed) — but the grid has processed the move so it won't list X anyway.
		s.setItems(SRC, [])
		expect(inFolder(s, SRC, 'X')).toBe(false)
		expect(inFolder(s, DST, 'X')).toBe(true)
	})
})
