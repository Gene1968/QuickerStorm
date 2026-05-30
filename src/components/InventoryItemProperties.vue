<script setup>
// Inventory Properties popover — item or folder details from data we already have (no asset fetch).
import { computed } from 'vue'
import FloaterWindow from '@/components/FloaterWindow.vue'
import { useInventoryStore } from '@/stores/inventoryStore'
import { assetTypeName } from '@/utils/inventoryIcons'

const inv    = useInventoryStore()
const target = computed(() => inv.propsTarget)
const isItem = computed(() => target.value?.kind === 'item')
const obj    = computed(() => target.value?.obj ?? {})

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
		id="inv-props"
		:title="isItem ? 'Item Properties' : 'Folder Properties'"
		:wrap-style="{ width: '22rem', height: 'auto', maxHeight: '80vh' }"
		:default-pos="{ left: '30%', top: '20%' }"
		@close="inv.closeProperties()"
	>
		<div class="p-3 text-xs text-t1 space-y-1.5 overflow-y-auto">
			<div class="font-semibold text-sm truncate">{{ obj.name }}</div>

			<template v-if="isItem">
				<div><span class="text-tm">Type:</span> {{ assetTypeName(obj.assetType) }}</div>
				<div v-if="obj.desc"><span class="text-tm">Description:</span> {{ obj.desc }}</div>
				<div class="font-mono break-all"><span class="text-tm font-sans">Item UUID:</span> {{ obj.itemId }}</div>
				<div class="font-mono break-all"><span class="text-tm font-sans">Asset UUID:</span> {{ obj.assetId || '—' }}</div>
				<div><span class="text-tm">Created:</span> {{ createdStr }}</div>
				<div class="flex gap-3 pt-1">
					<span :class="obj.canCopy ? 'text-green-400' : 'text-amber-400'">{{ perm(obj.canCopy) }} Copy</span>
					<span :class="obj.canModify ? 'text-green-400' : 'text-amber-400'">{{ perm(obj.canModify) }} Modify</span>
					<span :class="obj.canTransfer ? 'text-green-400' : 'text-amber-400'">{{ perm(obj.canTransfer) }} Transfer</span>
				</div>
			</template>

			<template v-else>
				<div class="font-mono break-all"><span class="text-tm font-sans">Folder UUID:</span> {{ obj.folderId }}</div>
				<div v-if="folderCounts"><span class="text-tm">Contents:</span> {{ folderCounts.items }} items, {{ folderCounts.folders }} folders</div>
				<div><span class="text-tm">Version:</span> {{ obj.version ?? '—' }}</div>
			</template>
		</div>
	</FloaterWindow>
</template>
