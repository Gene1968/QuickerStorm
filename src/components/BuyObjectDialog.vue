<script setup>
/**
 * BuyObjectDialog — FS reference LLFloaterBuy (llfloaterbuy.cpp:91-199). Single-instance:
 * uiStore.buyDialogTarget = { localId } for a for-sale prim in worldStore.objects (populated by
 * the usual ObjectProperties reply — same record ObjectEditFloater.vue reads owner/name/saleType/
 * salePrice/nextOwnerMask from). Opened by ObjectContextMenu "Buy" (a later sweep stage).
 *
 * Title: llfloaterbuy.cpp:119-128 — saleType 2=Copy → "Buy Copy of X", 3=Contents → "Buy Contents
 * of X", 1=Original → "Buy X" (see useMoney.buyTitleFor). Price line: "Buy for L$<price> from
 * <owner>". Confirm gates on a KNOWN insufficient balance (handle_buy, llviewermenu.cpp:7113-7119)
 * — a free (salePrice 0) buy always proceeds, and an unknown balance (stock OpenSim never answers
 * MoneyBalanceRequest with anything but 0, or the reply simply hasn't arrived yet) never blocks.
 */
import { computed, watch } from 'vue'
import { useUiStore } from '@/stores/uiStore.js'
import { useWorldStore } from '@/stores/worldStore.js'
import { useInventoryStore } from '@/stores/inventoryStore.js'
import { useGridSocialStore } from '@/stores/gridSocialStore.js'
import { useSocial } from '@/composables/useSocial'
import { useLLUDP } from '@/composables/useLLUDP'
import { useMoney, canAfford, buyTitleFor } from '@/composables/useMoney.js'
import { useNotifications } from '@/composables/useNotifications'
import { PERM_MOVE, PERM_MODIFY, PERM_COPY, PERM_TRANSFER, PERM_EXPORT } from '@/utils/objectPermissions.js'
import FloaterWindow from '@/components/FloaterWindow.vue'

const ZERO_UUID = '00000000-0000-0000-0000-000000000000'

const ui = useUiStore()
const world = useWorldStore()
const inv = useInventoryStore()
const social = useGridSocialStore()
const { requestNames } = useSocial()
const { buyObject } = useLLUDP()
const { balance } = useMoney()
const { notifyInfo } = useNotifications()

const localId = computed(() => ui.buyDialogTarget?.localId ?? null)
const obj = computed(() => localId.value != null ? world.objects.get(localId.value) : null)

const objName = computed(() => obj.value?.name || 'Object')
const ownerName = computed(() => {
	const id = obj.value?.ownerId
	if (!id || id === ZERO_UUID) return 'Unknown'
	return social.nameFor(id) || id
})
const saleType = computed(() => obj.value?.saleType ?? 0)
const salePrice = computed(() => Number(obj.value?.salePrice) || 0)

const title = computed(() => buyTitleFor(saleType.value, objName.value))

// FS mask_to_string letter order VMCT(X) (llpermissions.cpp:1023-1060) — local, non-exported
// (ObjectEditFloater.vue keeps its own copy the same way; these bit constants are the shared source).
function permLetters(mask) {
	if (mask == null) return '—'
	let s = ''
	if (mask & PERM_MOVE)     s += 'V'
	if (mask & PERM_MODIFY)   s += 'M'
	if (mask & PERM_COPY)     s += 'C'
	if (mask & PERM_TRANSFER) s += 'T'
	if (mask & PERM_EXPORT)   s += 'X'
	return s || '–'
}
const nextOwnerPerms = computed(() => permLetters(obj.value?.nextOwnerMask))

const affordable = computed(() => canAfford(salePrice.value, balance.value))

// Resolve the owner display name if ObjectProperties beat NAME_REPLY here (mirrors
// ObjectEditFloater.vue's creator/owner name resolution).
watch(() => obj.value?.ownerId, (id) => {
	if (id && id !== ZERO_UUID) requestNames([id])
}, { immediate: true })

function close() { ui.closeBuyDialog() }

function confirmBuy() {
	const id = localId.value
	if (id == null) return
	if (!affordable.value) {
		notifyInfo("You don't have enough L$", `Buying "${objName.value}" costs L$${salePrice.value}.`)
		return
	}
	const categoryId = inv.findSystemFolder(6) || ZERO_UUID
	// FS onClickBuy is fire-and-forget (llfloaterbuy.cpp:321-333) — no watchdog, no success toast;
	// the item appearing in inventory (and any sim AlertMessage refusal) is the only feedback.
	buyObject({ localId: id, saleType: saleType.value, salePrice: salePrice.value, categoryId })
	close()
}
</script>

<template>
	<FloaterWindow
		id="buy-object"
		:title="title"
		:wrap-style="{ width: '22rem' }"
		:default-pos="{ left: 'calc(50vw - 11rem)', top: 'calc(50vh - 8rem)' }"
		@close="close"
	>
		<div v-if="obj" class="flex flex-col gap-3 p-4 text-xs text-fg">
			<div class="flex items-center justify-between gap-2">
				<span class="text-fg-subtle">Object:</span>
				<span class="font-medium truncate" :title="objName">{{ objName }}</span>
			</div>
			<div class="flex items-center justify-between gap-2">
				<span class="text-fg-subtle">Owner:</span>
				<span class="truncate" :title="obj.ownerId">{{ ownerName }}</span>
			</div>
			<div class="flex items-center justify-between gap-2">
				<span class="text-fg-subtle">Next owner can:</span>
				<span class="font-mono">{{ nextOwnerPerms }}</span>
			</div>

			<div class="rounded-sm border border-edge bg-white/5 px-2 py-1.5 text-center">
				Buy for <span class="font-bold">L${{ salePrice }}</span> from {{ ownerName }}
			</div>
			<div v-if="!affordable" class="text-red-400 text-2xs">You don't have enough L$ for this purchase.</div>

			<div class="flex justify-end gap-2 mt-1">
				<button class="px-3 py-1 text-xs rounded-sm border border-edge text-fg hover:bg-white/5 transition-colors" @click="close">Cancel</button>
				<button
					class="px-3 py-1 text-xs rounded-sm bg-accent text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
					:disabled="!affordable"
					@click="confirmBuy"
				>Buy</button>
			</div>
		</div>
		<div v-else class="p-4 text-xs text-fg-subtle italic">This object is no longer available.</div>
	</FloaterWindow>
</template>
