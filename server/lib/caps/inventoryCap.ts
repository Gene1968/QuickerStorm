// server/lib/caps/inventoryCap.ts — FetchInventoryDescendents2 request/response shaping.
// Pure functions (tested offline) used by handlers/inventory.ts via encodeLLSD + decodeInvFolders.
import type { LLSDValue } from '../llsd'
import { llsd, type LLSDTyped } from './llsdEncode'
import { llsdNum, llsdStr } from '../llsd'

export interface InvItem {
	itemId: string; parentId: string; name: string; desc: string
	assetType: number; invType: number; assetId: string; flags: number
	createdAt: number
	// Full permission mask set (LLPermissions). ownerMask drives the "You can" badges;
	// nextOwnerMask drives the Next-Owner perms shown in the Properties floater.
	baseMask: number; ownerMask: number; groupMask: number; everyoneMask: number; nextOwnerMask: number
	canCopy: boolean; canModify: boolean; canTransfer: boolean
}
export interface InvSubfolder { folderId: string; parentId: string; name: string; typeDefault: number; version: number }
export interface InvFolder { folderId: string; items: InvItem[]; subfolders: InvSubfolder[] }

/** Build the {folders:[...]} request value. fetch_folders=1 (sim gates items on it). */
export function buildInvRequest(folderIds: string[], ownerId: string): { folders: Array<Record<string, LLSDTyped | number>> } {
	return {
		folders: folderIds.map(id => ({
			folder_id:     llsd.uuid(id),
			owner_id:      llsd.uuid(ownerId),
			fetch_folders: llsd.bool(true),
			fetch_items:   llsd.bool(true),
			sort_order:    0,
		})),
	}
}

/** Decode the FetchInventoryDescendents2 response into typed folders + items. */
export function decodeInvFolders(parsed: LLSDValue): InvFolder[] {
	const respFolders = Array.isArray((parsed as any)?.folders) ? (parsed as any).folders : []
	const out: InvFolder[] = []
	for (const f of respFolders) {
		const folderId = llsdStr(f?.folder_id)
		if (!folderId) continue
		const items: InvItem[] = (Array.isArray(f?.items) ? f.items : []).map((it: any) => {
			const perms = (it.permissions && typeof it.permissions === 'object') ? it.permissions : {}
			const baseMask      = llsdNum(perms.base_mask)
			const ownerMask     = llsdNum(perms.owner_mask)
			const groupMask     = llsdNum(perms.group_mask)
			const everyoneMask  = llsdNum(perms.everyone_mask)
			const nextOwnerMask = llsdNum(perms.next_owner_mask)
			return {
				itemId: llsdStr(it.item_id), parentId: llsdStr(it.parent_id),
				name: llsdStr(it.name), desc: llsdStr(it.desc),
				assetType: llsdNum(it.type), invType: llsdNum(it.inv_type),
				assetId: llsdStr(it.asset_id), flags: llsdNum(it.flags),
				createdAt: llsdNum(it.created_at),
				baseMask, ownerMask, groupMask, everyoneMask, nextOwnerMask,
				canCopy: (ownerMask & 0x8000) !== 0,
				canModify: (ownerMask & 0x4000) !== 0,
				canTransfer: (ownerMask & 0x2000) !== 0,
			}
		})
		// Subfolders ("categories"): so the client can discover folders created since the login
		// skeleton (e.g. via CreateInventoryCategory) without waiting for the next login. OpenSim
		// FetchInvDescHandler.cs emits category_id/parent_id/name/type_default/version per child.
		const subfolders: InvSubfolder[] = (Array.isArray(f?.categories) ? f.categories : []).map((c: any) => ({
			folderId: llsdStr(c.category_id),
			parentId: llsdStr(c.parent_id),
			name: llsdStr(c.name),
			typeDefault: llsdNum(c.type_default),
			version: llsdNum(c.version),
		})).filter((c: InvSubfolder) => c.folderId)
		out.push({ folderId, items, subfolders })
	}
	return out
}
