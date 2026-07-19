// useCurrentOutfit — read-model over the Current Outfit Folder (COF, folder type 46). Bundle 7·A.
//
// SL/OpenSim track "what am I wearing" as LINK items (assetType 24) inside the COF; each link's
// assetId points at the REAL inventory item (FS llappearancemgr.cpp getLinkedUUID usage). Worn
// classification per FS llassettype.h / llwearabletype.h:
//   AT_BODYPART=13 · AT_CLOTHING=5 · AT_OBJECT=6 (attachment) · AT_GESTURE=20 · AT_LINK=24
// Wearable sub-type lives in the item's flags low byte (LLWearableType::inventoryFlagsToWearableType,
// II_FLAGS_SUBTYPE_MASK=0xff — llinventorydefines.h).
//
// This is READ-ONLY (7·A): it makes the "Now wearing" floater real. Wear/unwear (COF link writes)
// and attachment mounting build on the identities exposed here (7·B).
import { computed, watch } from 'vue'
import { useInventoryStore } from '@/stores/inventoryStore'
import { useInventory } from '@/composables/useInventory'
import { useWorldStore } from '@/stores/worldStore'
import { useSessionStore } from '@/stores/sessionStore'
import { itemIcon, FOLDER_CURRENT_OUTFIT } from '@/utils/inventoryIcons'

const AT_CLOTHING = 5
const AT_OBJECT = 6
const AT_BODYPART = 13
const AT_GESTURE = 20
const AT_LINK = 24
const AT_LINK_FOLDER = 25

// LLWearableType::EType — llwearabletype.h:44-64 (WT_SHAPE=0 … WT_UNIVERSAL=16).
export const WEARABLE_TYPE_NAMES = [
	'Shape', 'Skin', 'Hair', 'Eyes', 'Shirt', 'Pants', 'Shoes', 'Socks', 'Jacket', 'Gloves',
	'Undershirt', 'Underpants', 'Skirt', 'Alpha', 'Tattoo', 'Physics', 'Universal',
]

export function wearableTypeName(flags) {
	return WEARABLE_TYPE_NAMES[(flags ?? 0) & 0xff] ?? 'Wearable'
}

export function useCurrentOutfit() {
	const inv = useInventoryStore()
	const worldStore = useWorldStore()
	const sessionStore = useSessionStore()
	const { fetchFolders } = useInventory()

	const cofFolderId = computed(() => inv.systemFolder(FOLDER_CURRENT_OUTFIT))

	/** Fetch/refresh the COF contents (idempotent; cheap single-folder cap fetch). */
	function refresh() {
		const id = cofFolderId.value
		if (id) fetchFolders([id])
	}

	// The sim bumps CofVersion in our own AvatarAppearance whenever the outfit changes
	// (wear/unwear from any viewer) — refetch the COF so the floater tracks live changes.
	const ownCofVersion = computed(() => {
		void worldStore.appearanceRev
		return worldStore.avatarAppearance(sessionStore.agentId)?.cofVersion
	})
	watch(ownCofVersion, (v, old) => { if (v != null && v !== old) refresh() })

	// COF rows → resolved worn items. A link row resolves to its target item when that folder is
	// already in the store (background fetchAll usually has it); otherwise the link row itself is
	// shown — COF links carry the target's name, so the label is still right.
	const wornItems = computed(() => {
		const id = cofFolderId.value
		if (!id) return []
		const rows = inv.folderItems(id)
		const out = []
		for (const row of rows) {
			if (row.assetType === AT_LINK_FOLDER) continue   // outfit-folder backlink, not a worn item
			const isLink = row.assetType === AT_LINK
			const target = isLink ? (inv.itemById(row.assetId) || null) : null
			const eff = target || row
			// A link's own assetType is 24 — the worn *kind* comes from the resolved target when we
			// have it, else from the link's invType (OpenSim mirrors the target's inv_type onto links).
			// invType 18 = wearable covers BOTH body parts and clothing — split on the wearable
			// sub-type in the flags low byte (WT_SHAPE/SKIN/HAIR/EYES = 0-3 are body parts).
			const kind = target ? target.assetType
				: (row.invType === 18 ? (((row.flags ?? 0) & 0xff) <= 3 ? AT_BODYPART : AT_CLOTHING)
					: (row.invType === 6 ? AT_OBJECT : row.assetType))
			out.push({
				linkId: row.itemId,
				itemId: target?.itemId || (isLink ? row.assetId : row.itemId),
				name: eff.name || row.name,
				assetType: kind,
				invType: eff.invType,
				flags: eff.flags,
				resolved: !!target || !isLink,
			})
		}
		return out
	})

	const bodyParts = computed(() => wornItems.value.filter(i => i.assetType === AT_BODYPART))
	const clothing = computed(() => wornItems.value.filter(i => i.assetType === AT_CLOTHING))
	const attachments = computed(() => wornItems.value.filter(i => i.assetType === AT_OBJECT))
	const gestures = computed(() => wornItems.value.filter(i => i.assetType === AT_GESTURE))

	function iconFor(item) { return itemIcon(item.assetType, item.invType) }
	function detailFor(item) {
		if (item.assetType === AT_BODYPART || item.assetType === AT_CLOTHING) return wearableTypeName(item.flags)
		if (item.assetType === AT_OBJECT) return 'Attachment'
		if (item.assetType === AT_GESTURE) return 'Gesture'
		return ''
	}

	return {
		cofFolderId, refresh, wornItems,
		bodyParts, clothing, attachments, gestures,
		iconFor, detailFor,
	}
}
