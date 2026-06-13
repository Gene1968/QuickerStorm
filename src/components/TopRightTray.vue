<script setup>
// TopRightTray — FS-style top-right cluster: a square button per open IM conversation (left), a
// Conversations button (opens the floater, shows total unread IMs), then the Notifications button
// (envelope with the unread count superimposed). Notifications opens NotificationsFloater directly
// below; that floater carries the linking caret.
import { computed } from 'vue'
import { useUiStore } from '@/stores/uiStore'
import { useInstantMessage } from '@/composables/useInstantMessage'
import { useNotificationStore } from '@/stores/notificationStore'
import { MessageCircleIcon, MailIcon } from '@lucide/vue'

const ui    = useUiStore()
const im    = useInstantMessage()
const notif = useNotificationStore()

const sessions = computed(() => [...im.conversations.value.values()])

// Tray buttons appear only when relevant: the IM cluster (session buttons + Conversations) when
// there are open conversations or unread IMs; the Notifications envelope when there are
// unread/uncleared notification items.
const hasIM     = computed(() => sessions.value.length > 0 || im.unreadCount.value > 0)
const hasNotifs = computed(() => notif.items.length > 0)

// Open (or focus) a conversation in the Conversations floater. The floater watches im.activeId
// and switches its active tab, so setting activeId + showing the floater is enough.
function openSession(c) {
	im.openWith(c.agentId, c.agentName)
	ui.showChat = true
}

// Two initials from "First Last" → "FL"; single-word → one letter; empty → 💬.
function initials(name) {
	const parts = (name || '').trim().split(/\s+/).filter(Boolean)
	if (!parts.length) return '💬'
	if (parts.length === 1) return parts[0].charAt(0).toUpperCase()
	return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
}
</script>

<template>
	<div class="fixed top-10 right-2 z-[150] flex items-start gap-2 select-none">
		<!-- Open IM conversations (FS stacks these to the left of the notifications well) -->
		<button
			v-for="c in sessions"
			:key="c.agentId"
			class="tray-btn text-xs font-semibold"
			:class="{ 'tray-btn--active': ui.showChat && im.activeId.value === c.agentId }"
			:title="`IM — ${c.agentName}`"
			@click="openSession(c)"
		>{{ initials(c.agentName) }}</button>

		<!-- Conversations: opens the floater; badge shows total unread IMs -->
		<button
			v-if="hasIM"
			class="tray-btn relative"
			:class="{ 'tray-btn--active': ui.showChat }"
			title="Conversations"
			@click="ui.toggleChat()"
		>
			<MessageCircleIcon class="w-5 h-5" />
			<span v-if="im.unreadCount.value" class="tray-badge">{{ im.unreadCount.value }}</span>
		</button>

		<!-- Notifications: envelope with the unread count superimposed; opens floater directly below -->
		<button
			v-if="hasNotifs"
			class="tray-btn relative"
			:class="{ 'tray-btn--active': ui.showNotifications }"
			title="Notifications"
			@click="ui.toggleNotifications()"
		>
			<MailIcon class="w-5 h-5" />
			<span v-if="notif.totalUnread" class="count-on-icon">{{ notif.totalUnread }}</span>
		</button>
	</div>
</template>

<style scoped>
/* Consistent, theme-aware, partially-transparent button bg. WHY color-mix instead of `bg-panel/50`:
   Tailwind opacity modifiers don't apply to CSS-var colors (see CLAUDE.md), so we mix the var with
   transparent here to get a real translucent fill that still follows the light/dark theme. */
.tray-btn {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 2rem;
	height: 2rem;
	border-radius: 0.375rem;
	border: 1px solid var(--edge);
	background: color-mix(in srgb, var(--panel) 55%, transparent);
	color: var(--fg);
	transition: background 0.15s, border-color 0.15s;
}
.tray-btn:hover { background: color-mix(in srgb, var(--panel) 85%, transparent); }
.tray-btn--active {
	background: color-mix(in srgb, var(--accent) 30%, transparent);
	color: #fff;
	border-color: var(--accent);
}

/* Corner badge (Conversations) */
.tray-badge {
	position: absolute;
	top: -0.25rem;
	right: -0.25rem;
	min-width: 0.95rem;
	padding: 0.05rem 0.2rem;
	background: #dc2626;
	color: #fff;
	border-radius: 9999px;
	font-size: 0.6rem;
	line-height: 1;
	text-align: center;
}

/* Count superimposed directly on the envelope glyph (white with a dark outline so it reads on the
   icon over any theme). Nudged slightly into the envelope body. */
.count-on-icon {
	position: absolute;
	top: 50%;
	left: 50%;
	transform: translate(-50%, -38%);
	font-size: 0.55rem;
	font-weight: 700;
	line-height: 1;
	color: #fff;
	text-shadow: 0 0 2px #000, 0 0 2px #000, 0 0 2px #000;
	pointer-events: none;
}
</style>
