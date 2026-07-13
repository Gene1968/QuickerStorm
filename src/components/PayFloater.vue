<script setup>
/**
 * PayFloater — FS reference LLFloaterPay (llfloaterpay.cpp:584-645). Single-instance: uiStore
 * holds one active `payTarget` = { targetId, targetName, kind: 'avatar'|'object'|'group' }, set
 * by the context-menu "Pay" rows (AvatarContextMenu / ObjectContextMenu — a later sweep stage
 * wires those disabled buttons to ui.openPayFloater(...)).
 *
 * Fast-pay buttons (L$1/5/10/20) + a free-entry amount + a Pay button that's disabled until the
 * amount is a positive number. transactionType and DestID/isDestGroup follow FS's mapping
 * (llfloaterpay.cpp:613-615): objects → TRANS_PAY_OBJECT, avatars/groups → TRANS_GIFT.
 *
 * NOTE (kept out of the UI, code-comment only): stock OpenSim's SampleMoneyModule.cs:747-750
 * (MoneyTransferAction) is an empty no-op — a Pay on an un-modded OpenSim grid silently does
 * nothing server-side. We still send it; the balance readout just won't move.
 */
import { ref, computed, watch } from 'vue'
import { useUiStore } from '@/stores/uiStore.js'
import { useLLUDP } from '@/composables/useLLUDP'
import { useMoney, canAfford, transactionTypeForKind, PAY_PRESETS } from '@/composables/useMoney.js'
import { useNotifications } from '@/composables/useNotifications'
import { useGridSocialStore } from '@/stores/gridSocialStore'
import { TRANS } from '@shared/protocol.js'
import FloaterWindow from '@/components/FloaterWindow.vue'

const ui = useUiStore()
const social = useGridSocialStore()
const { payMoney } = useLLUDP()
const { balance, balanceLabel, requestMoneyBalance } = useMoney()
const { notifyInfo } = useNotifications()

const target = computed(() => ui.payTarget)
const kind = computed(() => target.value?.kind || 'avatar')

// Prefer the live-resolved name (avatar id → gridSocialStore.names once NAME_REPLY lands) over
// whatever the opener passed in, but fall back to it immediately so the floater isn't blank.
const payeeName = computed(() => {
	const t = target.value
	if (!t) return ''
	if (kind.value === 'avatar') return social.nameFor(t.targetId) || t.targetName || t.targetId
	return t.targetName || t.targetId
})

const amount = ref(0)
const amountValid = computed(() => Number.isFinite(amount.value) && amount.value > 0)

watch(target, () => { amount.value = 0 }, { immediate: true })

function pickPreset(v) { amount.value = v }

function close() { ui.closePayFloater() }

function pay() {
	const t = target.value
	if (!t || !amountValid.value) return
	if (!canAfford(amount.value, balance.value)) {
		notifyInfo('Insufficient funds', `You don't have enough L$ to pay ${payeeName.value}.`)
		return
	}
	payMoney({
		destId: t.targetId,
		amount: Math.round(amount.value),
		transactionType: transactionTypeForKind(kind.value, TRANS),
		description: '',
		isDestGroup: kind.value === 'group',
	})
	close()
}

// Refresh the balance readout on open — cheap, and OpenSim's honest answer may have changed.
requestMoneyBalance()
</script>

<template>
	<FloaterWindow
		id="pay"
		title="Pay"
		:wrap-style="{ width: '20rem' }"
		:default-pos="{ left: 'calc(50vw - 10rem)', top: 'calc(50vh - 8rem)' }"
		@close="close"
	>
		<div class="flex flex-col gap-3 p-4 text-xs text-fg">
			<div class="flex items-center justify-between gap-2">
				<span class="text-fg-subtle">Pay to:</span>
				<span class="font-medium truncate" :title="target?.targetId">{{ payeeName || '—' }}</span>
			</div>
			<div class="flex items-center justify-between gap-2 text-fg-subtle">
				<span>Your balance:</span>
				<span class="font-mono">{{ balanceLabel() }}</span>
			</div>

			<div class="flex gap-1.5">
				<button
					v-for="p in PAY_PRESETS"
					:key="p"
					class="qs-btn flex-1 px-2 py-1 rounded-sm border border-brd text-xs hover:bg-white/5 transition-colors"
					:class="amount === p ? 'border-accent text-accent' : 'text-fg'"
					@click="pickPreset(p)"
				>L${{ p }}</button>
			</div>

			<label class="flex items-center gap-2">
				<span class="text-fg-subtle shrink-0">Amount:</span>
				<input
					v-model.number="amount"
					type="number"
					min="1"
					step="1"
					class="w-full bg-card border border-brd rounded-sm px-2 py-1 text-xs text-fg"
				/>
			</label>

			<div class="flex justify-end gap-2 mt-1">
				<button class="px-3 py-1 text-xs rounded-sm border border-edge text-fg hover:bg-white/5 transition-colors" @click="close">Cancel</button>
				<button
					class="px-3 py-1 text-xs rounded-sm bg-accent text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
					:disabled="!amountValid"
					@click="pay"
				>Pay</button>
			</div>
		</div>
	</FloaterWindow>
</template>
