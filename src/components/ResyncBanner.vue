<script setup>
/**
 * ResyncBanner — detects "stuck" world state after WS reconnect / HMR / page reload
 * and recovers via C.RESYNC_WORLD.
 *
 * Stuck conditions (any of, after GRACE_MS since the WS connected):
 *   1. session.connected but regionName still empty ("Entering region…")
 *   2. session.connected but no terrain heights have arrived
 *
 * Recovery is two-stage:
 *   - First time `stuck` flips true → silently auto-fire resync (no banner).
 *   - If still stuck BANNER_DELAY_MS after that auto-resync, show banner so the
 *     user can retry manually. This way the common reload case heals invisibly,
 *     and the banner only appears when auto-recovery itself failed.
 *
 * Server replies with replayCachedWorld() + sim-nudge AgentUpdate. Banner auto-hides
 * once regionName populates AND at least one terrain patch exists.
 */
import { computed, ref, watch, onUnmounted } from 'vue'
import { useSessionStore } from '@/stores/sessionStore'
import { useWorldStore } from '@/stores/worldStore'
import { useRealtimeSocket } from '@/composables/useRealtimeSocket'
import { useInventory } from '@/composables/useInventory'
import { C } from '@shared/protocol.js'
import { Repeat2Icon } from '@lucide/vue'

const session  = useSessionStore()
const world    = useWorldStore()
const { emit } = useRealtimeSocket()
const { resyncInventory } = useInventory()

const GRACE_MS        = 5000   // wait this long after WS connect before considering stuck
const BANNER_DELAY_MS = 4000   // grace after silent auto-resync before surfacing banner

const connectedSince  = ref(0)
const dismissed       = ref(0) // 0 = not dismissed, else timestamp
const lastResyncAt    = ref(0)
const autoResyncedAt  = ref(0) // timestamp of the silent auto-attempt for this session
// WHY: Reactive clock tick so time-based windows re-evaluate.
// Computed properties don't re-run on Date.now() alone — they need a ref dependency.
const nowTick = ref(Date.now())

const hasTerrain = computed(() => world.terrainPatchCount > 0)

// WHY: "stuck" = the underlying condition. Separate from banner visibility so we can
// auto-resync as soon as it flips true without flashing UI.
const stuck = computed(() => {
	if (!session.connected) return false
	if (!connectedSince.value) return false
	if (nowTick.value - connectedSince.value < GRACE_MS) return false
	if (!session.regionName) return true
	if (!hasTerrain.value)   return true
	return false
})

const showBanner = computed(() => {
	if (!stuck.value) return false
	if (dismissed.value) return false
	// Only surface UI if the silent auto-attempt already had time to land.
	if (!autoResyncedAt.value) return false
	return nowTick.value - autoResyncedAt.value >= BANNER_DELAY_MS
})

watch(() => session.connected, (c) => {
	if (c) {
		connectedSince.value = Date.now()
		dismissed.value      = 0
		autoResyncedAt.value = 0
	} else {
		connectedSince.value = 0
	}
}, { immediate: true })

// WHY: Auto-dismiss once both signals recover so the banner doesn't linger.
watch([() => session.regionName, hasTerrain], ([rn, ht]) => {
	if (rn && ht) dismissed.value = Date.now()
})

// WHY: Fire one silent resync the moment `stuck` flips true. Subsequent stuck cycles
// in the same session reset autoResyncedAt only on reconnect, so we don't spam the sim.
watch(stuck, (s) => {
	if (s && !autoResyncedAt.value) {
		autoResyncedAt.value = Date.now()
		resync()
	}
})

const tick = setInterval(() => { nowTick.value = Date.now() }, 1000)
onUnmounted(() => clearInterval(tick))

function resync() {
	if (Date.now() - lastResyncAt.value < 2000) return
	lastResyncAt.value = Date.now()
	emit(C.RESYNC_WORLD, {})
	resyncInventory()   // recover stuck inventory on the same action (no relog)
}

function dismiss() { dismissed.value = Date.now() }
</script>

<template>
	<Transition name="rb-fade">
		<div
			v-if="showBanner"
			class="rb-banner"
			role="alert"
		>
			<div class="rb-icon"><Repeat2Icon class="w-7 h-7" /></div>
			<div class="rb-text">
				<div class="rb-title">Scene not fully loaded</div>
				<div class="rb-sub">{{ !session.regionName ? 'Region name pending…' : 'Terrain pending…' }} Server may be holding a stale circuit after reload.</div>
			</div>
			<button class="rb-btn rb-btn--primary" @click="resync">Resync World</button>
			<button class="rb-btn rb-btn--ghost" @click="dismiss" title="Dismiss">✕</button>
		</div>
	</Transition>
</template>

<style scoped>
.rb-banner {
	position: absolute;
	top: 0.75rem;
	left: 50%;
	transform: translateX(-50%);
	z-index: 700;
	display: flex;
	align-items: center;
	gap: 0.75rem;
	padding: 0.5rem 0.75rem 0.5rem 0.875rem;
	background: rgba(20, 26, 40, 0.94);
	border: 1px solid rgba(255, 200, 80, 0.45);
	border-radius: 0.625rem;
	box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);
	color: #fff;
	min-width: 22rem;
	max-width: 36rem;
	backdrop-filter: blur(6px);
}
.rb-icon {
	font-size: 1.75rem;
	color: rgba(255, 200, 80, 0.95);
	animation: rb-spin 2.4s linear infinite;
}
.rb-text { flex: 1; min-width: 0; }
.rb-title { font-size: 0.8125rem; font-weight: 600; line-height: 1.1; }
.rb-sub   { font-size: 0.6875rem; color: rgba(255,255,255,0.6); margin-top: 0.125rem; line-height: 1.25; }
.rb-btn {
	padding: 0.3125rem 0.75rem;
	font-size: 0.75rem;
	font-weight: 500;
	border-radius: 0.375rem;
	border: 1px solid transparent;
	cursor: pointer;
	transition: background 0.1s, opacity 0.1s;
	white-space: nowrap;
}
.rb-btn--primary {
	background: rgba(255, 200, 80, 0.95);
	color: #1a1a1a;
}
.rb-btn--primary:hover { background: rgba(255, 215, 110, 1); }
.rb-btn--ghost {
	background: transparent;
	color: rgba(255,255,255,0.55);
	padding: 0.25rem 0.5rem;
}
.rb-btn--ghost:hover { color: #fff; background: rgba(255,255,255,0.08); }

@keyframes rb-spin {
	from { transform: rotate(0deg); }
	to   { transform: rotate(360deg); }
}

.rb-fade-enter-active { transition: opacity 0.2s, transform 0.2s; }
.rb-fade-leave-active { transition: opacity 0.15s; }
.rb-fade-enter-from  { opacity: 0; transform: translate(-50%, -8px); }
.rb-fade-leave-to    { opacity: 0; }
</style>
