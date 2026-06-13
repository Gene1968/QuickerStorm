<script setup>
import { onBeforeUnmount } from 'vue'
import { useNotificationStore } from '@/stores/notificationStore'

const notif = useNotificationStore()

// Per-toast fade timers. Non-sticky toasts auto-dismiss; hovering pauses.
const VISIBLE_MS = 6000
const timers = new Map()

function arm(id, sticky) {
	if (sticky || timers.has(id)) return
	timers.set(id, setTimeout(() => { notif.dismissToast(id); timers.delete(id) }, VISIBLE_MS))
}
function pause(id) { const t = timers.get(id); if (t) { clearTimeout(t); timers.delete(id) } }
function runAction(action) { try { action.run?.() } catch (e) { console.error('[toast action]', e) } }

onBeforeUnmount(() => { for (const t of timers.values()) clearTimeout(t); timers.clear() })
</script>

<template>
	<div class="fixed top-[5.5rem] right-3 z-[200] flex flex-col gap-2 w-[20rem] max-w-[90vw] pointer-events-none">
		<div
			v-for="t in notif.toasts"
			:key="t.id"
			class="qs-panel pointer-events-auto rounded-lg border border-edge bg-panel shadow-lg p-3"
			:class="t.kind === 'error' ? 'border-red-500' : t.kind === 'offer' ? 'border-accent' : ''"
			@mouseenter="pause(t.id)"
			@mouseleave="arm(t.id, t.sticky)"
			@vue:mounted="arm(t.id, t.sticky)"
		>
			<div class="flex items-start gap-2">
				<div class="flex-1 min-w-0">
					<div class="text-xs font-semibold text-fg truncate">{{ t.title }}</div>
					<div v-if="t.body" class="text-2xs text-fg-muted mt-0.5 break-words">{{ t.body }}</div>
				</div>
				<button class="text-fg-muted hover:text-fg text-xs leading-none shrink-0" title="Dismiss" @click="notif.dismissToast(t.id)">✕</button>
			</div>
			<div v-if="t.actions?.length" class="flex gap-2 mt-2 justify-end">
				<button
					v-for="(a, i) in t.actions"
					:key="i"
					class="px-2 py-0.5 rounded-sm text-2xs"
					:class="a.variant === 'primary' ? 'bg-accent text-white hover:opacity-80' : 'border border-edge text-fg hover:bg-white/10'"
					@click="runAction(a)"
				>{{ a.label }}</button>
			</div>
		</div>
	</div>
</template>
