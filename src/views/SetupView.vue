<script setup>
/**
 * SetupView — first-run onboarding: loads avatar config from IDB
 * and redirects to /office, showing AvatarMaker if not yet configured.
 */
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAvatarStore } from '@/stores/avatarStore.js'
import { useUserStore } from '@/stores/userStore.js'

const router      = useRouter()
const avatarStore = useAvatarStore()
const userStore   = useUserStore()

onMounted(async () => {
	await avatarStore.load()

	// Pre-populate from SharePoint user if available
	if (userStore.user && !avatarStore.displayName) {
		avatarStore.fromAuthUser(userStore.user)
	}

	// Always proceed to office — the avatar maker opens from within OfficeView
	router.replace('/office')
})
</script>

<template>
	<div class="setup-loading">
		<div class="setup-logo">AVA<span>verse</span></div>
		<div class="setup-spinner"></div>
		<div class="setup-msg">Loading your office&#8230;</div>
	</div>
</template>

<style scoped>
.setup-loading {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	background: var(--color-bg);
	width: 100%;
	min-width: 0;
	height: 100vh;
	gap: 1.25rem;
}

.setup-logo {
	font-size: clamp(2rem, 3.5vw, 3rem); font-weight: 900;
	color: var(--color-accent3);
	letter-spacing: -0.04em;
	font-family: 'EurostileExtended', 'RobotoFlex', sans-serif;
}
.setup-logo span {
	margin-left: 0.1rem;
	color: var(--color-tm);
	font-size: clamp(1.4rem, 2.2vw, 2rem);
	font-weight: 400;
	letter-spacing: 0.12em;
}

.setup-spinner {
	width: 2rem; height: 2rem;
	border: 3px solid var(--color-brd2);
	border-top-color: var(--color-accent);
	border-radius: 50%;
	animation: spin 0.8s linear infinite;
}

.setup-msg {
	font-size: clamp(0.75rem, 0.75vw, 0.9375rem); color: var(--color-tm);
}

@keyframes spin { to { transform: rotate(360deg); } }
</style>
