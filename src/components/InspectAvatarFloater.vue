<script setup>
/**
 * InspectAvatarFloater — FS reference LLInspectAvatar (llinspectavatar.cpp:329-469). A compact,
 * single-instance floater (uiStore.inspectAvatarId = the target agentId; opened from
 * AvatarContextMenu "Inspect" — a later sweep stage). Shows display name, born-on date + account
 * age, and About text — reusing the SAME AvatarPropertiesReply plumbing ProfileFloater.vue already
 * drives (useSocial().requestProfile + gridSocialStore.profileFor), rather than a second fetch path.
 *
 * "Account type / payment info" (FS's payment-status badge) isn't available on this bridge —
 * OpenSim/EQ never surfaces LLPaymentInfo — so that row is omitted rather than faked.
 *
 * Actions: View profile → ui.openProfile (full ProfileFloater); Send IM → dispatches the same
 * useInstantMessage().openWith + Conversations-focus flow as AvatarContextMenu.vue's startIM.
 */
import { computed, watch } from 'vue'
import { useUiStore } from '@/stores/uiStore.js'
import { useGridSocialStore } from '@/stores/gridSocialStore.js'
import { useSocial } from '@/composables/useSocial'
import { useInstantMessage } from '@/composables/useInstantMessage'
import FloaterWindow from '@/components/FloaterWindow.vue'

const ui = useUiStore()
const social = useGridSocialStore()
const { requestProfile, requestNames } = useSocial()
const im = useInstantMessage()

const avatarId = computed(() => ui.inspectAvatarId)
const profile = computed(() => avatarId.value ? social.profileFor(avatarId.value) : null)
const avProps = computed(() => profile.value?.properties ?? null)
const displayName = computed(() => (avatarId.value && social.nameFor(avatarId.value)) || avatarId.value || '')

// Same "MM/DD/YYYY" + age-in-years/months/days parse as ProfileFloater.vue's parseBornWithAge —
// duplicated locally (small, non-exported there too) rather than plumbing a shared export for one
// consumer; keep in sync if the FS date format ever changes.
const BORN_DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/
function parseBornWithAge(bornOn) {
	const raw = (bornOn ?? '').trim()
	if (!raw) return { date: 'N/A', age: null }
	const match = BORN_DATE_RE.exec(raw)
	if (!match) return { date: raw, age: null }
	const month = Number(match[1]), day = Number(match[2]), year = Number(match[3])
	const birth = new Date(year, month - 1, day)
	if (birth.getFullYear() !== year || birth.getMonth() !== month - 1 || birth.getDate() !== day) {
		return { date: raw, age: null }
	}
	const today = new Date()
	const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())
	if (birth > todayStart) return { date: raw, age: null }
	const totalDays = Math.floor((todayStart - birth) / 86_400_000)
	let years = today.getFullYear() - year
	let months = today.getMonth() - (month - 1)
	if (today.getDate() < day) { months--; if (months < 0) { years--; months += 12 } }
	else if (months < 0) { years--; months += 12 }
	const date = `${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}/${year}`
	return { date, age: `(${years}y ${months}m; ${totalDays}d)` }
}
const bornDisplay = computed(() => parseBornWithAge(avProps.value?.bornOn))
const aboutValue = computed(() => avProps.value?.aboutText || '(no about text)')

watch(avatarId, (id) => {
	if (!id) return
	requestProfile(id)
	requestNames([id])
}, { immediate: true })

function close() { ui.closeInspectAvatar() }
function viewProfile() {
	if (!avatarId.value) return
	ui.openProfile(avatarId.value)
	close()
}
function sendIM() {
	if (!avatarId.value) return
	im.openWith(avatarId.value, displayName.value)
	ui.showChat = true
	ui.focusFloater('conversations')
	close()
}
</script>

<template>
	<FloaterWindow
		id="inspect-avatar"
		title="Inspect Avatar"
		:wrap-style="{ width: '18rem' }"
		:default-pos="{ left: 'calc(50vw - 9rem)', top: 'calc(50vh - 8rem)' }"
		@close="close"
	>
		<div class="flex flex-col gap-2 p-4 text-xs text-fg">
			<div class="flex items-center gap-2">
				<div class="w-10 h-10 shrink-0 rounded-full bg-white/10 border border-edge flex items-center justify-center text-lg select-none">👤</div>
				<div class="min-w-0">
					<div class="font-bold truncate" :title="avatarId">{{ displayName || 'loading…' }}</div>
					<div class="text-2xs text-fg-subtle font-mono truncate" :title="avatarId">{{ avatarId }}</div>
				</div>
			</div>

			<div class="flex items-baseline gap-2 mt-1">
				<span class="text-fg-subtle shrink-0 w-16">Born:</span>
				<div class="min-w-0">
					<div>{{ bornDisplay.date }}</div>
					<div v-if="bornDisplay.age" class="text-2xs text-fg-subtle">{{ bornDisplay.age }}</div>
				</div>
			</div>

			<div class="flex flex-col gap-1">
				<span class="text-fg-subtle">About:</span>
				<div class="rounded-sm bg-white/5 border border-edge px-2 py-1.5 min-h-[3rem] whitespace-pre-wrap">{{ aboutValue }}</div>
			</div>

			<div class="flex justify-end gap-2 mt-1">
				<button class="px-3 py-1 text-xs rounded-sm border border-edge text-fg hover:bg-white/5 transition-colors" @click="sendIM">Send IM</button>
				<button class="px-3 py-1 text-xs rounded-sm bg-accent text-white transition-colors" @click="viewProfile">View profile</button>
			</div>
		</div>
	</FloaterWindow>
</template>
