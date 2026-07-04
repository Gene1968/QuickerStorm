// src/utils/rezzableAnchor.js — pure resolver for "can this inventory drag rez in-world?".
// Payload contract (inventoryStore.js dragPayload): { id, ids:[...], kind:'item'|'folder', count }
// — `id` is the drag ANCHOR (first of ids). Firestorm REFUSES multi-cargo drops onto land/objects
// outright: dad3dRezObjectOnLand/OnObject return ACCEPT_YES_SINGLE / ACCEPT_YES_COPY_SINGLE
// (phoenix-firestorm indra/newview/lltooldraganddrop.cpp:2491,2560), acceptanceToCursor maps
// multi-cargo + *_SINGLE to TooltipMustSingleDrop with a NO cursor (:513-521,549-557), and
// dragOrDrop3dImpl aborts the drop when acceptance < ACCEPT_YES_COPY_MULTI with >1 cargo
// (:674-681). So a multi-drag (count > 1) is rejected as 'multi' — never "rez just the anchor".
// A folder-anchor drag stays rejected. Pure (lookup injected) → unit-testable.
import { ASSET_TYPE_OBJECT } from '@/composables/useInventory'

/**
 * @param dragPayload  inventoryStore.dragPayload (or null when no drag is live)
 * @param findItem     (id) => { item, folderId } | null   (inventoryStore.findItem)
 * @returns {{ itemId: string } | { reason: 'none'|'multi'|'folder'|'not-object' }}
 *   itemId       → rez it
 *   'none'       → no live inventory drag / no anchor (ignore the drop silently)
 *   'multi'      → more than one thing dragged (toast: one item at a time — FS TooltipMustSingleDrop)
 *   'folder'     → anchor is a folder (toast: folders can't be rezzed)
 *   'not-object' → anchor isn't a rezzable OBJECT item, or wasn't found (toast: objects only)
 */
export function resolveRezzableAnchor(dragPayload, findItem) {
	const p = dragPayload
	if (!p || !p.id) return { reason: 'none' }
	// FS single-drop rule: world rez accepts exactly ONE cargo (lltooldraganddrop.cpp:674-681);
	// checked before anchor kind — acceptanceToCursor fires on cargo count alone (:513-521).
	if ((p.count ?? p.ids?.length ?? 1) > 1) return { reason: 'multi' }
	if (p.kind === 'folder') return { reason: 'folder' }
	const found = findItem(p.id)
	// assetType 6 = OBJECT (useInventory.ASSET_TYPE_OBJECT); an unresolved anchor (stale drag,
	// purged row) is treated the same as a non-object — nothing rezzable to act on.
	if (!found?.item || found.item.assetType !== ASSET_TYPE_OBJECT) return { reason: 'not-object' }
	return { itemId: p.id }
}
