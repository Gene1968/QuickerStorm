// src/composables/useMoney.js — L$ balance tracking + Pay/Buy pure-logic helpers.
//
// Wire: C.MONEY_BALANCE_REQ (requestMoneyBalance) → S.MONEY_BALANCE { balance, description,
// transactionId, success }. FS process_money_balance_reply (llviewermessage.cpp:5755-5821) both
// updates the L$ readout AND narrates the transaction via Description ("Bob paid you L$5" etc) —
// we mirror that: every non-empty Description toasts, not just the balance number.
//
// OpenSim caveat (SampleMoneyModule.cs:596-601 GetFundsForAgentID): stock grids with no real money
// module ALWAYS report balance 0. We show 'L$0' as a normal value but never let a null/unknown
// balance (before the first reply lands) block a Pay/Buy action — only a KNOWN insufficient
// balance blocks (see canAfford below).
//
// Module-singleton (mirrors useTaskInventory.js): balance state + the socket handler survive
// floater open/close; `on()` is keyed so HMR/re-mount never stacks duplicate handlers.
import { ref, watch } from 'vue'
import { S } from '@shared/protocol.js'
import { useRealtimeSocket } from '@/composables/useRealtimeSocket'
import { useLLUDP } from '@/composables/useLLUDP'
import { useSessionStore } from '@/stores/sessionStore'
import { useNotificationStore } from '@/stores/notificationStore'

// null = unknown (no reply yet); otherwise the last-reported L$ balance.
const _balance = ref(null)

let _inited = false

function _onMoneyBalance(d) {
	if (d?.balance != null) _balance.value = Number(d.balance) || 0
	// FS-parity: the sim narrates transactions through Description ("You paid ... L$5.") —
	// surface it as a toast so a Pay/Buy/transfer the user didn't initiate (an incoming gift,
	// a vendor purchase from someone else) is visible, matching process_money_balance_reply.
	if (d?.description) {
		useNotificationStore().pushToast({ kind: 'info', title: 'Transaction', body: d.description })
	}
}

// Once per login/socket-ready: request the balance so the L$ readout isn't blank on entry.
let _requestedOnce = false
function requestMoneyBalanceOnce() {
	if (_requestedOnce) return
	_requestedOnce = true
	_requestBalance()
}
function _requestBalance() { useLLUDP().requestMoneyBalance() }

function _init() {
	if (_inited) return
	_inited = true
	const { on } = useRealtimeSocket()
	on(S.MONEY_BALANCE, _onMoneyBalance, 'money:balance')
	const session = useSessionStore()
	watch(() => session.connected, (c) => { if (c) requestMoneyBalanceOnce() }, { immediate: true })
}

// NOTE (2026-07-13): an earlier 10s "silent-refusal watchdog" toast here was REMOVED for FS
// parity — LLFloaterBuy::onClickBuy (llfloaterbuy.cpp:321-333) is fire-and-forget with NO
// timeout/no-response detection of any kind; success feedback is only the item appearing in
// inventory, plus the MoneyBalanceReply description toast when the grid sends one (priced buys).
// Genuine sim refusals (BlueBox / AlertMessage) already auto-toast via the S.ALERT_MESSAGE path.

// ── Pure logic (unit-tested) ─────────────────────────────────────────────────────────────────

/** FS handle_buy gate (llviewermenu.cpp:7113-7119): a free (0) buy always proceeds; a priced
 * buy is blocked only when the balance is KNOWN and insufficient — an unknown balance (null,
 * stock-OpenSim-never-replied) never blocks. */
export function canAfford(price, balance) {
	const p = Number(price) || 0
	if (p <= 0) return true
	if (balance == null) return true
	return p <= balance
}

/** LLFloaterBuy title logic (llfloaterbuy.cpp:119-128): saleType 2=Copy → "Buy Copy of X",
 * 3=Contents → "Buy Contents of X", 1=Original (or unknown) → "Buy X". */
export function buyTitleFor(saleType, name) {
	const n = name || 'Object'
	if (saleType === 2) return `Buy Copy of ${n}`
	if (saleType === 3) return `Buy Contents of ${n}`
	return `Buy ${n}`
}

/** llfloaterpay.cpp:613-615 — objects pay via TRANS_PAY_OBJECT, avatars and groups via TRANS_GIFT. */
export function transactionTypeForKind(kind, TRANS) {
	return kind === 'object' ? TRANS.PAY_OBJECT : TRANS.GIFT
}

/** Fast-pay preset amounts shown as buttons in LLFloaterPay (llfloaterpay.cpp — btn "1"/"5"/"10"/"20"). */
export const PAY_PRESETS = [1, 5, 10, 20]

export function useMoney() {
	_init()

	function balanceLabel() {
		return _balance.value == null ? 'L$—' : `L$${_balance.value}`
	}

	return {
		balance: _balance,
		balanceLabel,
		requestMoneyBalance: _requestBalance,
	}
}

// Test-only reset (module state otherwise persists for the process lifetime).
export function __resetMoneyStateForTests() {
	_balance.value = null
	_inited = false
	_requestedOnce = false
}
