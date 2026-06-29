<script setup>
// Inventory Properties popover — item or folder details from data we already have (no asset fetch).
// One instance per opened item/folder (driven by inventoryStore.propsTargets); each gets its own
// FloaterWindow id so multiple can be open at once.
// NOTE: fields here are DISPLAY/placeholders. Editing (name/description save, the perms checkboxes,
// the For-Sale section, Experience) is NOT wired to the server yet — see docs/FEATURE-GAPS.md.
import { computed } from 'vue'
import FloaterWindow from '@/components/FloaterWindow.vue'
import { useInventoryStore } from '@/stores/inventoryStore'
import { assetTypeName } from '@/utils/inventoryIcons'

const props = defineProps({
	// { key, kind:'item'|'folder', obj } from inventoryStore.propsTargets.
	target: { type: Object, required: true },
	// Stacking order among open Properties floaters — used to cascade the default position.
	index:  { type: Number, default: 0 },
})

const inv    = useInventoryStore()
const target = computed(() => props.target)
const isItem = computed(() => target.value?.kind === 'item')
const obj    = computed(() => target.value?.obj ?? {})

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

function perm(ok) { return ok ? '✓' : '✗' }
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
					<span :class="obj.canModify ? 'text-green-400' : 'text-amber-400'">{{ perm(obj.canModify) }} Modify</span>
					<span :class="obj.canCopy ? 'text-green-400' : 'text-amber-400'">{{ perm(obj.canCopy) }} Copy</span>
					<span :class="obj.canTransfer ? 'text-green-400' : 'text-amber-400'">{{ perm(obj.canTransfer) }} Transfer</span>
				</div>
				<div class="flex align-center gap-3">
					<h6 class="w-12 text-3xs text-fg-muted">Anyone:</h6>
					<div>[✓] Copy</div>
				</div>
				<div class="flex align-center gap-3">
					<h6 class="w-12 text-3xs text-fg-muted">Group:</h6>
					<div>[&nbsp; ] Share</div>
				</div>
				<h6 class="mb-0 text-3xs text-fg-muted">Next owner:</h6>
				<div class="flex gap-3">
					<span>[✓] Modify</span>
					<span>[✓] Copy</span>
					<span>[✓] Transfer</span>
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
