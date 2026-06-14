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

// Display initials for tray buttons. "First Last" → "FL"; SL grid names like
// "Gene.Freenote @hg.gbg-world.com:8002" → "GF@G" (name initials + @ + domain hint).
function initials(name) {
	const trimmed = (name || '').trim()
	if (!trimmed) return '💬'

	const gridMatch = trimmed.match(/^(.+?)\s+@(.+)$/)
	if (gridMatch) {
		const displayPart = gridMatch[1].trim()
		const hostPart = gridMatch[2].trim()
		const displaySegments = displayPart.split(/[.\s]+/).filter(Boolean)
		const displayInitials = displaySegments.length > 1
			? displaySegments[0].charAt(0) + displaySegments[displaySegments.length - 1].charAt(0)
			: displaySegments[0]?.charAt(0) ?? ''
		const hostname = hostPart.split(':')[0]
		const hostSegments = hostname.split('.').filter(Boolean)
		const domainLetter = hostSegments.length > 1
			? hostSegments[1].charAt(0)
			: hostSegments[0]?.charAt(0) ?? ''
		return (displayInitials + '@' + domainLetter).toUpperCase()
	}

	const parts = trimmed.split(/\s+/).filter(Boolean)
	if (parts.length === 1) {
		const dotParts = parts[0].split('.').filter(Boolean)
		if (dotParts.length > 1) {
			return (dotParts[0].charAt(0) + dotParts[dotParts.length - 1].charAt(0)).toUpperCase()
		}
		return parts[0].charAt(0).toUpperCase()
	}
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
			<span v-if="im.unreadCount.value" class="tray-alert-badge">x{{ im.unreadCount.value }}</span>
			<span v-else class="tray-count-badge">{{ [...im.conversations.value.values()].length }}</span>
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
	border-radius: 0.375rem;
	border: 1px solid var(--edge);
	background: color-mix(in srgb, var(--panel) 55%, transparent);
	padding: 0 0.25rem;
	min-width: 2rem;
	height: 2rem;
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
.tray-alert-badge {
	position: absolute;
	top: -0.25rem;
	right: -0.25rem;
	border-radius: 50%;
	background: #dc2626;
	padding: 0.05rem 0.2rem;
	min-height: 0.95rem;
	min-width: 0.95rem;
	font-size: 0.6rem;
	font-weight: 700;
	line-height: 1.2;
	text-align: center;
	color: #fff;
}
.tray-count-badge {
	position: absolute;
	border-radius: 50%;
	background: #fff;
	margin-top: 0.01rem;
	min-height: 0.95rem;
	min-width: 0.95rem;
	font-size: 0.55rem;
	font-weight: 700;
	line-height: 1.5;
	text-align: center;
	color: #666;
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
