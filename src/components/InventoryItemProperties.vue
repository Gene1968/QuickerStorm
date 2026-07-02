<script setup>
// Inventory Properties popover — item or folder details from data we already have (no asset fetch).
// One instance per opened item/folder (driven by inventoryStore.propsTargets); each gets its own
// FloaterWindow id so multiple can be open at once.
// NOTE: name/description save, the For-Sale section, and Experience are still DISPLAY-only and NOT
// wired to the server yet — see docs/FEATURE-GAPS.md. The Permissions checkboxes (Next-owner /
// Share-with-group / Allow-anyone-copy) ARE wired via useInventory().updatePerms.
import { computed } from 'vue'
import FloaterWindow from '@/components/FloaterWindow.vue'
import { useInventory } from '@/composables/useInventory'
import { useInventoryStore } from '@/stores/inventoryStore'
import { assetTypeName } from '@/utils/inventoryIcons'

const props = defineProps({
	// { key, kind:'item'|'folder', obj } from inventoryStore.propsTargets.
	target: { type: Object, required: true },
	// Stacking order among open Properties floaters — used to cascade the default position.
	index:  { type: Number, default: 0 },
})

const inv    = useInventoryStore()
const { updatePerms } = useInventory()
const target = computed(() => props.target)
const isItem = computed(() => target.value?.kind === 'item')
// Prefer the LIVE store row for items so a permission toggle re-renders the checkboxes immediately
// (the target.obj snapshot in propsTargets is frozen at open time and won't reflect updatePerms).
const obj    = computed(() => {
	const snap = target.value?.obj ?? {}
	if (target.value?.kind === 'item' && snap.itemId) {
		const live = inv.findItem(snap.itemId)?.item
		if (live) return live
	}
	return snap
})

// SL sale types (LLSaleInfo): 1=Original, 2=Copy, 3=Contents. (0=not-for-sale is the checkbox.)
const SALE_TYPE_OPTIONS = [
	{ value: 1, label: 'Original' },
	{ value: 2, label: 'Copy' },
	{ value: 3, label: 'Contents' },
]

// WHY: cascade each new Properties floater down-right so stacked ones don't perfectly overlap.
const floaterId  = computed(() => `inv-props-${target.value.key}`)
const defaultPos = computed(() => ({
	left: `calc(30vw + ${props.index * 1.5}rem)`,
	top:  `calc(33vh + ${props.index * 1.5}rem)`,
}))

const createdStr = computed(() => {
	const t = obj.value.createdAt
	if (!t) return '—'
	try { return new Date(t * 1000).toLocaleString() } catch { return String(t) }
})
const folderCounts = computed(() => (!isItem.value && obj.value.folderId) ? inv.descendantCounts(obj.value.folderId) : null)

// SL permission mask bits (phoenix-firestorm llpermissionsflags.h).
const PERM_TRANSFER = 0x2000
const PERM_MODIFY   = 0x4000
const PERM_COPY     = 0x8000

// Group "Share" and Anyone "Copy" mirror Firestorm llfloaterproperties.cpp: the group checkbox
// reflects group_mask & PERM_COPY and the everyone checkbox everyone_mask & PERM_COPY.
const groupCanShare  = computed(() => ((obj.value.groupMask    | 0) & PERM_COPY) !== 0)
const anyoneCanCopy  = computed(() => ((obj.value.everyoneMask | 0) & PERM_COPY) !== 0)

// Editability gate mirrors FS: only the owner of a modifiable item may re-restrict permissions.
// We use the owner PERM_MODIFY bit (obj.canModify) as the "is_obj_modify && can_agent_manipulate"
// proxy since QuickerStorm tracks ownerMask, not the full base_mask.
const isModifiable      = computed(() => !!obj.value.canModify)
const canEditNextModify = computed(() => isModifiable.value && !!obj.value.canModify)
const canEditNextCopy   = computed(() => isModifiable.value && !!obj.value.canCopy)
// FS gates Next-owner-Transfer on next_owner_mask & PERM_COPY.
const canEditNextXfer   = computed(() => isModifiable.value && !!obj.value.nextCanCopy)
const canEditGroup      = computed(() => isModifiable.value)
// FS: Allow-anyone-copy needs the owner to hold both COPY and TRANSFER.
const canEditAnyone     = computed(() => isModifiable.value && !!obj.value.canCopy && !!obj.value.canTransfer)

// Toggle one permission bit in one of the masks and push the change through the write path
// (updatePerms → updateItemPermsLocal + INV_UPDATE_PERMS emit). Only the masks we changed are
// sent; the store recomputes the convenience flags. Mirrors LLFloaterProperties::onCommitPermissions.
function setMaskBit(maskKey, bit, on) {
	const cur  = (obj.value[maskKey] | 0)
	const next = on ? (cur | bit) : (cur & ~bit)
	if (next === cur) return
	// Resolve the live parent folder so updatePerms' server-field lookup finds the current row —
	// the snapshot in `obj` may predate a move.
	const folderId = inv.findItem(obj.value.itemId)?.folderId
	updatePerms(obj.value.itemId, folderId, { [maskKey]: next >>> 0 })
}

// Share-with-group sets/clears the COPY | MODIFY | MOVE trio, matching FS setGroupBits.
const PERM_MOVE = 0x0080
function onToggleGroup(on) { setMaskBit('groupMask', PERM_COPY | PERM_MODIFY | PERM_MOVE, on) }
function onToggleAnyone(on) { setMaskBit('everyoneMask', PERM_COPY, on) }
function onToggleNext(bit, on) { setMaskBit('nextOwnerMask', bit, on) }
</script>

<template>
	<FloaterWindow
		v-if="target"
		:id="floaterId"
		:title="isItem ? 'Item Properties' : 'Folder Properties'"
		:wrap-style="{ width: '16rem', maxHeight: '80vh' }"
		:default-pos="defaultPos"
		@close="inv.closePropertiesFor(target.key)"
	>
		<div class="p-2 text-xs text-fg space-y-1.5 overflow-y-auto">
			<div class="flex items-center gap-1 font-semibold text-xs truncate">
				<span title="typeicon" class="-ms-1 text-base">📦</span>
				<input type="text" :value="obj.name" readonly class="border border-edge rounded-sm bg-fg/20 px-1.5 py-0.5 w-full text-fg read-only:opacity-60 read-only:cursor-not-allowed"></input>
			</div>

			<template v-if="isItem">
				<div>
					<span class="text-2xs text-fg-muted">Description:</span>
					<textarea v-model="obj.desc" name="" id="" rows="2" class="qs-input border border-edge rounded-sm bg-panel px-2 py-1 w-full text-fg resize-none"></textarea>
				</div>
				<span class="text-2xs text-fg-muted">Experience:</span>
				<hr class="border-edge my-1" />
				<div class="mb-0 font-mono break-all text-3xs"><span class="text-fg-muted">Type:</span> {{ assetTypeName(obj.assetType) }}</div>
				<div class="mb-0 font-mono break-all text-3xs"><span class="text-fg-muted font-sans">Item UUID:</span> {{ obj.itemId }}</div>
				<div class="mb-0 font-mono break-all text-3xs"><span class="text-fg-muted font-sans">Asset UUID:</span> {{ obj.assetId || '—' }}</div>
				<div class="font-mono break-all text-3xs"><span class="text-fg-muted font-sans">Created:</span> {{ createdStr }}</div>
				<h5 class="text-2xs text-fg-muted">Permissions</h5>
				<h6 class="mb-0 text-3xs text-fg-muted">You can:</h6>
				<div class="flex gap-3">
					<label class="flex items-center gap-1 text-fg/60"><input type="checkbox" :checked="!!obj.canModify" disabled class="accent-accent" /> Modify</label>
					<label class="flex items-center gap-1 text-fg/60"><input type="checkbox" :checked="!!obj.canCopy" disabled class="accent-accent" /> Copy</label>
					<label class="flex items-center gap-1 text-fg/60"><input type="checkbox" :checked="!!obj.canTransfer" disabled class="accent-accent" /> Transfer</label>
				</div>
				<div class="flex items-center gap-3">
					<h6 class="w-12 text-3xs text-fg-muted">Anyone:</h6>
					<label class="flex items-center gap-1" :class="canEditAnyone ? 'text-fg cursor-pointer' : 'text-fg-muted'"><input type="checkbox" :checked="anyoneCanCopy" :disabled="!canEditAnyone" class="accent-accent" @change="onToggleAnyone($event.target.checked)" /> Copy</label>
				</div>
				<div class="flex items-center gap-3">
					<h6 class="w-12 text-3xs text-fg-muted">Group:</h6>
					<label class="flex items-center gap-1" :class="canEditGroup ? 'text-fg cursor-pointer' : 'text-fg-muted'"><input type="checkbox" :checked="groupCanShare" :disabled="!canEditGroup" class="accent-accent" @change="onToggleGroup($event.target.checked)" /> Share</label>
				</div>
				<h6 class="mb-0 text-3xs text-fg-muted">Next owner:</h6>
				<div class="flex gap-3">
					<label class="flex items-center gap-1" :class="canEditNextModify ? 'text-fg cursor-pointer' : 'text-fg-muted'"><input type="checkbox" :checked="!!obj.nextCanModify" :disabled="!canEditNextModify" class="accent-accent" @change="onToggleNext(PERM_MODIFY, $event.target.checked)" /> Modify</label>
					<label class="flex items-center gap-1" :class="canEditNextCopy ? 'text-fg cursor-pointer' : 'text-fg-muted'"><input type="checkbox" :checked="!!obj.nextCanCopy" :disabled="!canEditNextCopy" class="accent-accent" @change="onToggleNext(PERM_COPY, $event.target.checked)" /> Copy</label>
					<label class="flex items-center gap-1" :class="canEditNextXfer ? 'text-fg cursor-pointer' : 'text-fg-muted'"><input type="checkbox" :checked="!!obj.nextCanTransfer" :disabled="!canEditNextXfer" class="accent-accent" @change="onToggleNext(PERM_TRANSFER, $event.target.checked)" /> Transfer</label>
				</div>
				<hr class="border-edge my-1" />
				<div class="grid grid-cols-[4.5rem_1fr] text-xs">
					<label class="flex items-center justify-end gap-1 bg-fg/20 h-full pe-2 ps-1 text-fg/50 whitespace-nowrap"><input type="checkbox" :checked="(obj.saleType ?? 0) > 0" disabled class="accent-accent" /> For Sale</label>
					<div class="flex items-center gap-1 bg-fg/20 py-1">
						<select title="Whether purchaser receives original, copy, or contents." disabled class="qs-input bg-panel border border-edge rounded-sm px-2 py-1 text-fg">
							<option v-for="o in SALE_TYPE_OPTIONS" :key="o.value" :value="o.value" :selected="o.value === (obj.saleType ?? 0)">{{ o.label }}</option>
						</select>
					</div>
					<div class="flex items-center justify-end gap-1 bg-fg/20 h-full pe-2 text-fg/50 text-end self-center">Price ??$</div>
					<div class="flex items-center gap-1 bg-fg/20 pb-1">
						<input type="number" min="0" max="999999999" step="1" :value="obj.salePrice" readonly
						class="qs-input bg-panel border border-edge rounded-sm px-2 py-1 w-20 text-fg" />
						<button title="Mark/Update object(s) for sale." class="ui-btn p-1 px-5 text-xs rounded-sm border transition-colors">Apply</button>
					</div>
				</div>

			</template>

			<template v-else>
				<div class="font-mono break-all"><span class="text-fg-muted font-sans">Folder UUID:</span> {{ obj.folderId }}</div>
				<div v-if="folderCounts"><span class="text-fg-muted">Contents:</span> {{ folderCounts.items }} items, {{ folderCounts.folders }} folders</div>
				<div><span class="text-fg-muted">Version:</span> {{ obj.version ?? '—' }}</div>
			</template>
		</div>
	</FloaterWindow>
</template>
