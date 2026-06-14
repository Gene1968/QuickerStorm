<script setup>
import { ref, computed } from 'vue'
import FloaterWindow from '@/components/FloaterWindow.vue'
import { useUiStore } from '@/stores/uiStore'
import { useNotificationStore } from '@/stores/notificationStore'

const ui    = useUiStore()
const notif = useNotificationStore()

const TABS = [
	{ id: 'system',       label: 'System' },
	{ id: 'transactions', label: 'Transactions' },
	{ id: 'invitations',  label: 'Invitations' },
	{ id: 'group',        label: 'Group' },
]
const activeTab = ref('system')
const items = computed(() => notif.tabItems(activeTab.value))

function onItemClick(it) { if (!it.read) notif.markRead(it.id) }
function runAction(a) { try { a.run?.() } catch (e) { console.error('[notif action]', e) } }
</script>

<template>
	<FloaterWindow
		id="notifications"
		title="Notifications"
		:wrap-style="{ width: '24vw', height: '42vh', resize: 'both' }"
		:default-pos="{ right: '0.3vw', top: '7.25vh' }"
		caret-dir="up"
		@close="ui.toggleNotifications()"
	>
		<div class="flex flex-col flex-1 min-h-0">
			<nav class="flex border-b border-edge shrink-0 text-xs">
				<button
					v-for="t in TABS"
					:key="t.id"
					class="px-2.5 py-1.5 border-b-2 -mb-px"
					:class="activeTab === t.id ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg'"
					@click="activeTab = t.id"
				>
					{{ t.label }} <span class="text-fg-muted">({{ notif.unreadCount(t.id) }})</span>
				</button>
			</nav>

			<div v-if="activeTab === 'system'" class="flex-1 overflow-y-auto min-h-0">
				<div v-if="!items.length" class="h-full flex items-center justify-center text-fg-muted text-xs italic select-none">
					No notifications.
				</div>
				<div
					v-for="it in items"
					:key="it.id"
					class="px-2.5 py-2 border-b border-edge cursor-default"
					:class="it.read ? 'opacity-60' : 'bg-white/5'"
					@click="onItemClick(it)"
				>
					<div class="flex items-start gap-1">
						<div class="flex-1 min-w-0">
							<div class="text-xs text-fg font-medium break-words">{{ it.title }}</div>
							<div v-if="it.body" class="text-2xs text-fg-muted mt-0.5 break-words">{{ it.body }}</div>
						</div>
						<button class="shrink-0 text-fg-muted hover:text-fg text-xs leading-none mt-0.5" title="Dismiss" @click.stop="notif.removeItem(it.id)">✕</button>
					</div>
					<div v-if="it.actions?.length" class="flex gap-2 mt-1.5">
						<button
							v-for="(a, i) in it.actions"
							:key="i"
							class="px-2 py-0.5 rounded-sm text-2xs"
							:class="a.variant === 'primary' ? 'bg-accent text-white hover:opacity-80' : 'border border-edge text-fg hover:bg-white/10'"
							@click.stop="runAction(a)"
						>{{ a.label }}</button>
					</div>
				</div>
			</div>

			<div v-else class="flex-1 flex items-center justify-center text-fg-muted text-xs italic select-none">
				No {{ activeTab }} notifications connected yet.
			</div>

			<div v-if="activeTab === 'system' && items.length" class="px-2 py-1.5 border-t border-edge shrink-0 flex justify-end">
				<button class="px-2 py-0.5 text-2xs rounded-sm border border-edge text-fg hover:bg-white/10" @click="notif.clearTab('system')">Clear all</button>
			</div>
		</div>
	</FloaterWindow>
</template>

<style scoped></style>
