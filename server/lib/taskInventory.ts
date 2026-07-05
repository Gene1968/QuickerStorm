// server/lib/taskInventory.ts — parser for the legacy tab-indented task (prim) inventory
// file format delivered via Xfer after ReplyTaskInventory.
//
// Format authority (writer): OpenSim SceneObjectPartInventory.cs:1637 InventoryStringBuilder —
//   "\tinv_object\t0\n\t{\n" header (obj_id/parent_id/type=category/name Contents|), then per
//   item "\tinv_item\t0\n\t{\n" with a nested `permissions 0 { … }` sub-block (hex U32 masks via
//   Utils.UIntToHexString, SceneObjectPartInventory.cs:1527-1531), optional group_owned, a
//   `sale_info 0 { … }` sub-block, asset_id (ZERO when perms deny — :1550-1575), type/inv_type
//   as STRINGS, flags hex, and name/desc terminated by '|' (:1585-1586).
// Parse model (reader): FS llviewerobject.cpp:3524 loadTaskInvFile → llinventory.cpp:738
//   LLInventoryItem::importLegacyStream (keyword/value scanf lines, `{`/`}` section nesting,
//   name/desc = text up to '|', hex sscanf for masks/flags) and llpermissions.cpp:570
//   LLPermissions::importLegacyStream.

// Asset-type names → numeric LLAssetType (FS llassettype.cpp:74-106 dictionary TYPE NAME column;
// numeric values llassettype.h:37-133; OpenSim writes the same strings via Utils.AssetTypeToString,
// cross-checked vs SLUtil.cs:159-183 name2Asset).
const ASSET_TYPE_BY_NAME: Record<string, number> = {
	texture: 0, sound: 1, callcard: 2, landmark: 3, script: 4, clothing: 5, object: 6,
	notecard: 7, category: 8, lsltext: 10, lslbyte: 11, txtr_tga: 12, bodypart: 13,
	snd_wav: 17, img_tga: 18, jpeg: 19, animatn: 20, gesture: 21, simstate: 22,
	link: 24, link_f: 25, mesh: 49, settings: 56, material: 57, gltf: 58, glbin: 59,
}

// Inventory-type names → numeric LLInventoryType (FS llinventorytype.cpp:70-95 dictionary;
// numeric values llinventorytype.h:43-68).
const INV_TYPE_BY_NAME: Record<string, number> = {
	texture: 0, sound: 1, callcard: 2, landmark: 3, object: 6, notecard: 7,
	category: 8, root: 9, script: 10, snapshot: 15, attach: 17, wearable: 18,
	animation: 19, gesture: 20, mesh: 22, gltf: 23, glbin: 24, settings: 25, material: 26,
}

// Sale-type names → numeric (FS llsaleinfo.cpp FOR_SALE_NAMES: "not"=0, "orig"=1, "copy"=2,
// "cntn"=3; OpenSim always writes "not"/0 — SceneObjectPartInventory.cs:1580-1583).
const SALE_TYPE_BY_NAME: Record<string, number> = { not: 0, orig: 1, copy: 2, cntn: 3 }

const ZERO_UUID = '00000000-0000-0000-0000-000000000000'

// shadow_id = asset_id XOR MAGIC_ID (FS llinventory.cpp:73 MAGIC_ID + :804 LLXORCipher decrypt).
// OpenSim's InventoryStringBuilder never emits shadow_id, but SL-era files do — support both.
const MAGIC_ID = '3c115e51-04f4-523c-9fa6-98aff1034730'

function xorWithMagic(uuid: string): string {
	const hex = (s: string) => s.replace(/-/g, '')
	const a = hex(uuid), b = hex(MAGIC_ID)
	if (a.length !== 32) return ZERO_UUID
	let out = ''
	for (let i = 0; i < 32; i += 2) {
		const v = (parseInt(a.slice(i, i + 2), 16) ^ parseInt(b.slice(i, i + 2), 16))
		out += v.toString(16).padStart(2, '0')
	}
	return `${out.slice(0, 8)}-${out.slice(8, 12)}-${out.slice(12, 16)}-${out.slice(16, 20)}-${out.slice(20)}`
}

export interface TaskInvItem {
	itemId:        string
	parentId:      string   // the prim's UUID (task id)
	assetId:       string   // ZERO_UUID when the sim withheld it (perm-gated, SceneObjectPartInventory.cs:1550-1575)
	assetType:     number   // numeric LLAssetType (llassettype.h:37)
	invType:       number   // numeric LLInventoryType (llinventorytype.h:43)
	flags:         number
	name:          string
	desc:          string
	creationDate:  number
	// permissions sub-block (hex U32 masks — llpermissions.cpp:601-630)
	baseMask:      number
	ownerMask:     number
	groupMask:     number
	everyoneMask:  number
	nextOwnerMask: number
	creatorId:     string
	ownerId:       string
	lastOwnerId:   string
	groupId:       string
	groupOwned:    boolean
	// sale_info sub-block
	saleType:      number
	salePrice:     number
}

function emptyItem(): TaskInvItem {
	return {
		itemId: ZERO_UUID, parentId: ZERO_UUID, assetId: ZERO_UUID,
		assetType: -1, invType: -1, flags: 0, name: '', desc: '', creationDate: 0,
		baseMask: 0, ownerMask: 0, groupMask: 0, everyoneMask: 0, nextOwnerMask: 0,
		creatorId: ZERO_UUID, ownerId: ZERO_UUID, lastOwnerId: ZERO_UUID, groupId: ZERO_UUID,
		groupOwned: false, saleType: 0, salePrice: 0,
	}
}

// First two whitespace-separated tokens of a line — mirrors FS's `sscanf(" %254s %254s")`
// (llinventory.cpp:756): leading tabs/spaces are skipped, keyword/value split on whitespace.
function tokens(line: string): [string, string] {
	const m = line.match(/^\s*(\S+)(?:\s+(\S+))?/)
	return [m?.[1] ?? '', m?.[2] ?? '']
}

// name/desc lines carry free text ending with '|' — FS reads `%254s%254[\t]%254[^|]`
// (llinventory.cpp:874-880): everything after the keyword's tab run, up to the pipe.
// A bare '|' (empty value) parses to '' (FS's "IW: sscanf chokes" guard, :883).
function pipeValue(line: string, keyword: string): string {
	const idx = line.indexOf(keyword)
	if (idx < 0) return ''
	let rest = line.slice(idx + keyword.length).replace(/^[\t ]+/, '')
	const pipe = rest.indexOf('|')
	if (pipe >= 0) rest = rest.slice(0, pipe)
	// FS replaces stray pipes with spaces (LLStringUtil::replaceChar(mName,'|',' ')) — already cut.
	return rest
}

const hexU32 = (v: string): number => (parseInt(v, 16) >>> 0) || 0

/** Parse one legacy task-inventory file (UTF-8 text) into its item rows.
 *  inv_object blocks (the synthetic "Contents" category row, InventoryStringBuilder ctor) are
 *  consumed and skipped — FS keeps them only as a folder placeholder. Unknown keywords are
 *  ignored (FS warns-once and continues, llviewerobject.cpp:3570). */
export function parseTaskInventory(text: string): TaskInvItem[] {
	const lines = text.split('\n')
	const items: TaskInvItem[] = []
	let i = 0

	// Skip a `{ … }` section entirely (used for inv_object blocks we don't keep).
	const skipSection = (): void => {
		let depth = 0
		for (; i < lines.length; i++) {
			const [kw] = tokens(lines[i])
			if (kw === '{') depth++
			else if (kw === '}') { depth--; if (depth <= 0) { i++; return } }
		}
	}

	// Parse a permissions sub-block (llpermissions.cpp:570 importLegacyStream).
	const parsePermissions = (item: TaskInvItem): void => {
		for (; i < lines.length; i++) {
			const [kw, val] = tokens(lines[i])
			if (kw === '{') continue
			if (kw === '}') { i++; return }
			switch (kw) {
				case 'base_mask':       item.baseMask      = hexU32(val); break
				case 'creator_mask':    item.baseMask      = hexU32(val); break  // legacy alias (llpermissions.cpp:601)
				case 'owner_mask':      item.ownerMask     = hexU32(val); break
				case 'group_mask':      item.groupMask     = hexU32(val); break
				case 'everyone_mask':   item.everyoneMask  = hexU32(val); break
				case 'next_owner_mask': item.nextOwnerMask = hexU32(val); break
				case 'creator_id':      item.creatorId     = val; break
				case 'owner_id':        item.ownerId       = val; break
				case 'last_owner_id':   item.lastOwnerId   = val; break
				case 'group_id':        item.groupId       = val; break
				case 'group_owned':     item.groupOwned    = val === '1'; break
			}
		}
	}

	// Parse a sale_info sub-block (FS llsaleinfo.cpp importLegacyStream: sale_type + sale_price).
	const parseSaleInfo = (item: TaskInvItem): void => {
		for (; i < lines.length; i++) {
			const [kw, val] = tokens(lines[i])
			if (kw === '{') continue
			if (kw === '}') { i++; return }
			if (kw === 'sale_type') item.saleType = SALE_TYPE_BY_NAME[val] ?? 0
			else if (kw === 'sale_price') item.salePrice = parseInt(val, 10) || 0
		}
	}

	// Parse one inv_item `{ … }` block (llinventory.cpp:738 importLegacyStream).
	const parseItem = (): TaskInvItem => {
		const item = emptyItem()
		for (; i < lines.length;) {
			const line = lines[i]
			const [kw, val] = tokens(line)
			if (kw === '{') { i++; continue }
			if (kw === '}') { i++; break }
			switch (kw) {
				case 'item_id':       item.itemId = val; i++; break
				case 'parent_id':     item.parentId = val; i++; break
				case 'permissions':   i++; parsePermissions(item); break
				case 'sale_info':     i++; parseSaleInfo(item); break
				case 'asset_id':      item.assetId = val; i++; break
				case 'shadow_id':     item.assetId = xorWithMagic(val); i++; break
				case 'type':          item.assetType = ASSET_TYPE_BY_NAME[val] ?? -1; i++; break
				case 'inv_type':      item.invType = INV_TYPE_BY_NAME[val] ?? -1; i++; break
				case 'flags':         item.flags = hexU32(val); i++; break
				case 'name':          item.name = pipeValue(line, 'name'); i++; break
				case 'desc':          item.desc = pipeValue(line, 'desc'); i++; break
				case 'creation_date': item.creationDate = parseInt(val, 10) || 0; i++; break
				default: i++; break   // unknown keyword — skip (FS warns and continues)
			}
		}
		// FS falls back to the asset type's default inventory type when inv_type is missing/bad
		// (llinventory.cpp:929 defaultForAssetType) — minimal port: mirror asset type when known.
		if (item.invType === -1 && item.assetType >= 0) {
			const DEFAULT_IT: Record<number, number> = { 0: 0, 1: 1, 2: 2, 3: 3, 4: 10, 5: 18, 6: 6, 7: 7, 8: 8, 10: 10, 11: 10, 13: 18, 20: 19, 21: 20, 49: 22, 56: 25, 57: 26 }
			item.invType = DEFAULT_IT[item.assetType] ?? -1
		}
		return item
	}

	while (i < lines.length) {
		const [kw] = tokens(lines[i])
		if (kw === 'inv_item') { i++; items.push(parseItem()) }
		else if (kw === 'inv_object') { i++; skipSection() }   // synthetic "Contents" category row
		else i++
	}
	return items
}
