<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useModalAudio } from '@/composables/useModalAudio.js'
useModalAudio()

const emit = defineEmits(['close'])

function onEscCapture (e) {
	if (e.key !== 'Escape') return
	e.preventDefault()
	e.stopPropagation()
	emit('close')
}
onMounted(() => document.addEventListener('keydown', onEscCapture, true))
onUnmounted(() => document.removeEventListener('keydown', onEscCapture, true))

const activeTab = ref(0)
const tabs = ['Navigation', 'Connections', 'TBD']
</script>

<template>
	<Teleport to="body">
		<div class="help-overlay" @click.self="$emit('close')">
			<div class="help-panel">
				<!-- Header -->
				<div class="help-header">
					<span class="help-title">Help</span>
					<button class="help-close" @click="$emit('close')" aria-label="Close">✕</button>
				</div>

				<!-- Tab nav -->
				<div class="help-tabs">
					<button
						v-for="(tab, i) in tabs"
						:key="tab"
						class="help-tab"
						:class="{ active: activeTab === i }"
						@click="activeTab = i"
					>{{ tab }}</button>
				</div>

				<!-- Tab content -->
				<div class="help-body">

					<!-- ── Navigation ─────────────────────────────────── -->
					<div v-if="activeTab === 0" class="help-section">
						<h3 class="help-section-title">Getting around AVA<small>verse</small></h3>

						<div class="help-cards">
							<div class="help-card">
								<div class="help-card-icon">🚪</div>
								<div>
									<div class="help-card-label">Change rooms</div>
									<div class="help-card-desc">Choose a room from the sidebar, or click any floor of any room (either POV or overhead) to move yourself to that spot. Your camera view will follow along.</div>
								</div>
							</div>
							<div class="help-card">
								<div class="help-card-icon">🏢</div>
								<div>
									<div class="help-card-label">Your office</div>
									<div class="help-card-desc">With our ad hoc seating, any office you grab becomes your personal space with items visible only to you. Select the apps you use, &amp; they'll be pinned to your app shelf. We'll be adding more productivity features here like doc sharing.</div>
								</div>
							</div>
							<div class="help-card">
								<div class="help-card-icon">🖱️</div>
								<div>
									<div class="help-card-label">Walk / move / sit</div>
									<div class="help-card-desc">
										<p class="mb-1">Click any floor area to walk there. Your avatar will face the destination and travel over. Alt/Option+drag to rotate your avatar in place if you like.</p>
										<p class="mb-1">Use <kbd>W</kbd>/<kbd>S</kbd> to walk forward or back up, and <kbd>A</kbd>/<kbd>D</kbd> (or arrow keys) to rotate — the camera always follows behind you. Combine <kbd>W</kbd>+<kbd>A</kbd>/<kbd>D</kbd> to curve while moving. Keys disable automatically whenever a text field or panel is open.</p>
										<p>Click a chair or desk to sit. Click the floor to stand back up and walk to that spot. While seated, <kbd>A</kbd>/<kbd>D</kbd> (or arrow keys) rotate you in place; <kbd>W</kbd>/<kbd>S</kbd> do not move you.</p>
									</div>
								</div>
							</div>
							<div class="help-card">
								<div class="help-card-icon">🔭</div>
								<div>
									<div class="help-card-label">View and camera</div>
									<div class="help-card-desc"><p class="mb-1"><strong>Drag</strong> to change your camera view &amp; see around you, or hold Alt/Opt &amp; use <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or arrow keys. <strong>Scrollwheel</strong> to zoom in/out. Alt/Opt+click to change the camera focal point (useful before zooming into something).</p><p>Toggle the <strong>Overhead</strong> button (top right) to see the whole office from above for quick navigation. If you get lost, press <kbd>Esc</kbd> or <kbd>Home</kbd> or the <strong>↺</strong> reset button (left of Overhead) to snap the camera back to your current room/self. Alt+scroll to move the camera view up/down, and if your scrollwheel allows you can pan the camera with Alt+L/R wheel.</p></div>
								</div>
							</div>
							<div class="help-card">
								<div class="help-card-icon">👆</div>
								<div>
									<div class="help-card-label">Interact with people</div>
									<div class="help-card-desc">Click a user in the sidebar to go visit their location. On the canvas, clickan avatar to open their profile popup. From there you can greet them, send a message, or visit their location for a chat. Some of those actions will rotate both avatars to face each other.</div>
								</div>
							</div>
							<div class="help-card">
								<div class="help-card-icon">🗺️</div>
								<div>
									<div class="help-card-label">2D vs 3D views</div>
									<div class="help-card-desc">By default if your device can handle it, you'll see a high-graphics 3D view of the office. Phones, small screens &amp; less powerful devices should get a simpler 2D view. You can toggle between the two any time by clicking the <strong>Simple 2D view</strong> or <strong>3D graphical view</strong> link in the corner menu.</div>
								</div>
							</div>
							<!-- <div class="help-card">
								<div class="help-card-icon">🪑</div>
								<div>
									<div class="help-card-label">Sit &amp; stand</div>
									<div class="help-card-desc">Click a chair or desk to sit. Click the floor to stand back up and walk to that spot.</div>
								</div>
							</div>
							<div class="help-card">
								<div class="help-card-icon">🔄</div>
								<div>
									<div class="help-card-label">Reset camera</div>
									<div class="help-card-desc">If you get lost, use the <strong>↺</strong> reset button (left of the Overhead button) to snap back to your current room/self (Esc/Home).</div>
								</div>
							</div> -->
						</div>
					</div>

					<!-- ── Connections ────────────────────────────────────────── -->
					<div v-if="activeTab === 1" class="help-section">
						<h3 class="help-section-title">AVA<small>verse</small> integrations</h3>

						<div class="help-cards">
							<div class="help-card">
								<div class="help-card-icon">🎤</div>
								<div>
									<div class="help-card-label">Voice &amp; sound</div>
									<div class="help-card-desc">Choose <em class="fw-bold">Join Voice</em> in the bar near the bottom left to connect. Your mic is muted by default — click it to unmute, press <strong>Shift+Alt+A</strong> to toggle, or hold <kbd>Spacebar</kbd> for push-to-talk. Open Settings to pick the right mic and speakers if needed.</div>
								</div>
							</div>

							<div class="help-card disabled">
								<div class="help-card-icon">💬</div>
								<div>
									<div class="help-card-label">Connect Slack</div>
									<div class="help-card-desc">Go to <strong>Settings → Slack</strong> and click <em>Connect Slack</em> to link your account. Once connected, DMs you send from quickerSTORM come from you rather than from the generic quickerSTORM bot, and you'll get full DM history inline. Without it, messages still work but appear as bot posts.</div>
								</div>
							</div>

							<div class="help-card">
								<div class="help-card-icon">📅</div>
								<div>
									<div class="help-card-label">Google Calendar</div>
									<div class="help-card-desc">Go to <strong>Settings → Integrations</strong> and click <em>Connect Google</em> using your AVA work account (not personal). This shows you today's meetings on the conference-room projector screen and your office calendar, and alerts you before a meeting starts. Note: the connection expires after one hour and you'll need to reconnect (we'll upgrade this soon).</div>
								</div>
							</div>

							<div class="help-card">
								<div class="help-card-icon">🔢</div>
								<div>
									<div class="help-card-label">Google account index</div>
									<div class="help-card-desc">If you have multiple Google accounts signed in, use the <strong>+/-</strong> control in Settings to tell quickerSTORM which slot is your work account. <strong>0</strong> is usually your first/personal account, <strong>1</strong> is your second (work), and so on. This ensures calendar links and Drive previews open in the right account.</div>
								</div>
							</div>
							<div class="py-24"></div>
						</div>
					</div>

					<!-- ── TBD ────────────────────────────────────────── -->
					<div v-if="activeTab === 2" class="help-section">
						<h3 class="help-section-title">Next AVA<small>verse</small> help section</h3>

						<div class="help-tbd py-64"><span class="help-tbd-label">Coming soon</span></div>
					</div>

				</div>
			</div>
		</div>
	</Teleport>
</template>

<style scoped>
.help-overlay {
	position: fixed;
	inset: 0;
	background: rgba(0, 0, 0, 0.65);
	display: flex;
	align-items: center;
	justify-content: center;
	z-index: 850;
	backdrop-filter: blur(4px);
}

.help-panel {
	width: min(50rem, 96vw);
	max-height: 88vh;
	background: var(--color-card);
	border: 1px solid var(--color-brd);
	border-radius: 0.875rem;
	box-shadow: 0 16px 64px rgba(0, 0, 0, 0.6);
	display: flex;
	flex-direction: column;
	overflow: hidden;
}

/* Header */
.help-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 1rem 1.375rem;
	border-bottom: 1px solid var(--color-brd);
	background: var(--color-card2);
	flex-shrink: 0;
}
.help-title {
	font-size: clamp(0.875rem, 0.875vw, 1.0625rem);
	font-weight: 700;
	color: var(--color-t1);
}
.help-close {
	background: none;
	border: none;
	color: var(--color-tm);
	font-size: clamp(0.8rem, 0.8vw, 0.9375rem);
	cursor: pointer;
	padding: 0.25rem 0.375rem;
	border-radius: 0.25rem;
	line-height: 1;
}
.help-close:hover { color: var(--color-t1); background: rgba(255,255,255,0.05); }

/* Tabs */
.help-tabs {
	display: flex;
	gap: 0;
	border-bottom: 1px solid var(--color-brd);
	background: var(--color-card2);
	flex-shrink: 0;
	padding: 0 1rem;
}
.help-tab {
	background: none;
	border: none;
	border-bottom: 2px solid transparent;
	color: var(--color-tm);
	font-size: clamp(0.75rem, 0.75vw, 0.875rem);
	font-weight: 500;
	padding: 0.625rem 0.875rem;
	cursor: pointer;
	transition: color 0.12s, border-color 0.12s;
	margin-bottom: -1px;
}
.help-tab:hover { color: var(--color-t1); }
.help-tab.active {
	color: var(--color-accent);
	border-bottom-color: var(--color-accent);
}

/* Body */
.help-body {
	flex: 1;
	overflow-y: auto;
	padding: 1.5rem;
}

.help-section-title {
	font-size: clamp(0.8rem, 0.8vw, 0.9375rem);
	font-weight: 700;
	color: var(--color-t2);
	text-transform: uppercase;
	letter-spacing: 0.06em;
	margin-bottom: 1rem;
}

/* Cards grid */
.help-cards {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr));
	gap: 0.75rem;
}

.help-card {
	display: flex;
	align-items: flex-start;
	gap: 0.75rem;
	background: var(--color-card2);
	border: 1px solid var(--color-brd);
	border-radius: 0.625rem;
	padding: 0.875rem 1rem;
}
.help-card-icon {
	font-size: 1.375rem;
	flex-shrink: 0;
	line-height: 1;
	margin-top: 0.0625rem;
}
.help-card-label {
	font-size: clamp(0.75rem, 0.75vw, 0.875rem);
	font-weight: 600;
	color: var(--color-t1);
	margin-bottom: 0.25rem;
}
.help-card-desc {
	font-size: clamp(0.6875rem, 0.7vw, 0.8125rem);
	color: var(--color-t2);
	line-height: 1.5;
}
.help-card-desc strong { color: var(--color-t1); font-weight: 600; }

/* TBD tab */
.help-tbd {
	display: flex;
	align-items: center;
	justify-content: center;
	height: 12rem;
}
.help-tbd-label {
	font-size: 0.875rem;
	color: var(--color-tm);
	font-style: italic;
}

.help-card.disabled {
	background: var(--color-t2);
	border: 1px solid var(--color-t1);
	opacity: 0.65;
	cursor: not-allowed;
}
.help-card.disabled .help-card-desc {
	color: black;
}
</style>
