<script setup>
/**
 * PreferencesFloater — full Firestorm-style preferences dialog.
 * Vertical tabs, search bar, OK/Cancel. Floater — no backdrop.
 * Available pre-login and post-login (mounted in App.vue via uiStore).
 *
 * OK:     commits any pending changes and closes.
 * Cancel: reverts live-preview changes (theme) and closes.
 */
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useTheme } from '@/composables/useTheme.js'
import { useAvatarStore } from '@/stores/avatarStore.js'
import { useUiStore } from '@/stores/uiStore.js'
import {
	isAllAudioMuted, toggleAllAudioMute,
	masterVolume, interfaceVolume, interfaceMuted,
} from '@/composables/useAudio.js'
import { useProximityVoice } from '@/composables/useProximityVoice.js'
import { Search as SearchIcon } from '@lucide/vue'
import FloaterWindow from '@/components/FloaterWindow.vue'
import { useAccountsStore } from '@/stores/accountsStore.js'
import { useGridStore }     from '@/stores/gridStore.js'

const ui            = useUiStore()
const theme         = useTheme()
const avatarStore   = useAvatarStore()
const accountsStore = useAccountsStore()
const gridStore     = useGridStore()

function formatLastUsed(ts) {
	if (!ts) return 'Never'
	const days = Math.floor((Date.now() - ts) / 86400000)
	if (days === 0) return 'Today'
	if (days === 1) return 'Yesterday'
	if (days < 7)   return `${days} days ago`
	return new Date(ts).toLocaleDateString()
}

// ── State ─────────────────────────────────────────────────────────────────
const search    = ref('')
const activeTab = computed({
	get: () => ui.preferenceActiveTab,
	set: (v) => { ui.preferenceActiveTab = v },
})

// ── Sound & Media sub-tabs ────────────────────────────────────────────────
const activeSoundTab = ref('sounds')

const soundSubTabs = [
	{ id: 'sounds', label: 'Sounds' },
	{ id: 'music',  label: 'Music'  },
	{ id: 'media',  label: 'Media'  },
	{ id: 'voice',  label: 'Voice'  },
]

const soundStubRows = [
	{ label: 'Ambient', hint: 'Environment sounds — wind, water.' },
	{ label: 'Sounds',  hint: 'In-world object sounds.' },
	{ label: 'Music',   hint: 'Parcel music stream.' },
	{ label: 'Media',   hint: 'In-world video / stream.' },
	{ label: 'Voice',   hint: 'Voice chat output.' },
]

const voice      = useProximityVoice()
const micDevices = computed(() => voice.audioDevices.value.filter(d => d.kind === 'audioinput'))
const spkDevices = computed(() => voice.audioDevices.value.filter(d => d.kind === 'audiooutput'))
const canSetSink = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype

function toSlider(vol)         { return Math.round(vol * 100) }
function fromSlider(e, volRef) { volRef.value = e.target.valueAsNumber / 100 }

// Load device list when Sound tab opened
watch(activeTab, async (tab) => {
	if (tab === 'sound' && voice.loadDevices) {
		try { await voice.loadDevices() } catch {}
	}
})

// Track theme at open so Cancel can revert
const originalDark = ref(theme.isDark.value)

// ── Tab definitions ────────────────────────────────────────────────────────
const ALL_TABS = [
	{ id: 'general',       icon: '⚙️',  label: 'General',       disabled: false, soon: false },
	{ id: 'accounts',      icon: '👤',  label: 'Accounts',      disabled: false, soon: false },
	{ id: 'appearance',    icon: '🎨',  label: 'Appearance',    disabled: false, soon: false },
	{ id: 'chat',          icon: '💬',  label: 'Chat',          disabled: false, soon: true  },
	{ id: 'graphics',      icon: '🖥️',  label: 'Graphics',      disabled: false, soon: true  },
	{ id: 'sound',         icon: '🔊',  label: 'Sound & Media', disabled: false, soon: false },
	{ id: 'move',          icon: '🎮',  label: 'Move & View',   disabled: true,  soon: false },
	{ id: 'notifications', icon: '🔔',  label: 'Notifications', disabled: true,  soon: false },
	{ id: 'privacy',       icon: '🔒',  label: 'Privacy',       disabled: true,  soon: false },
	{ id: 'opensim',       icon: '🌐',  label: 'OpenSim',       disabled: false, soon: true  },
	{ id: 'advanced',      icon: '🔧',  label: 'Advanced',      disabled: true,  soon: false },
]

const visibleTabs = computed(() => {
	const q = search.value.trim().toLowerCase()
	if (!q) return ALL_TABS
	return ALL_TABS.filter(t => t.label.toLowerCase().includes(q))
})

function selectTab(tab) {
	if (tab.disabled) return
	activeTab.value = tab.id
}

// ── OK / Cancel ────────────────────────────────────────────────────────────
function ok() {
	originalDark.value = theme.isDark.value // commit
	ui.showPreferences = false
}

function cancel() {
	// Revert theme if changed during this dialog session
	if (theme.isDark.value !== originalDark.value) {
		theme.setDark(originalDark.value)
	}
	ui.showPreferences = false
}

// ── Keyboard ───────────────────────────────────────────────────────────────
// WHY: Enter = OK; Esc reserved for camera reset, not floater close
function onKey(e) {
	if (e.key === 'Enter' && e.target?.tagName !== 'TEXTAREA') ok()
}

onMounted(() => {
	originalDark.value = theme.isDark.value
	window.addEventListener('keydown', onKey)
})
onUnmounted(() => {
	window.removeEventListener('keydown', onKey)
})
</script>

<template>
	<FloaterWindow
		id="preferences"
		title="Preferences"
		:wrap-style="{ width: 'clamp(32rem, 58vw, 52rem)', height: 'clamp(26rem, 72vh, 44rem)' }"
		@close="cancel"
	>
		<!-- ── Search ─────────────────────────────────────────────────── -->
			<div class="pf-searchbar">
				<SearchIcon class="pf-search-icon" style="width:0.85rem;height:0.85rem" />
				<input
					v-model="search"
					class="pf-search-input"
					type="text"
					placeholder="Search settings…"
					autocomplete="off"
					spellcheck="false"
				/>
			</div>

			<!-- ── Body: tabs + content ───────────────────────────────────── -->
			<div class="pf-body">

				<!-- Left: vertical tab strip -->
				<nav class="vtabs pf-tabnav">
					<button
						v-for="tab in visibleTabs"
						:key="tab.id"
						class="pf-tab"
						:class="{
							'pf-tab--active':   !tab.disabled && activeTab === tab.id,
							'pf-tab--disabled': tab.disabled,
						}"
						:disabled="tab.disabled"
						:title="tab.disabled ? tab.label + ' (coming soon)' : tab.label"
						@click="selectTab(tab)"
					>
						<span class="pf-tab-icon">{{ tab.icon }}</span>
						<span class="pf-tab-label">{{ tab.label }}</span>
						<span v-if="tab.disabled" class="pf-tab-badge">soon</span>
					</button>
				</nav>

				<!-- Right: tab content -->
				<div class="pf-content">

					<!-- ── ACCOUNTS ── -->
					<template v-if="activeTab === 'accounts'">
						<h2 class="pf-section-heading">Saved Accounts</h2>

						<template v-if="accountsStore.accounts.length">
							<div
								v-for="acct in accountsStore.accounts"
								:key="acct.username + '@' + acct.gridNick"
								class="pf-row"
							>
								<div class="pf-row-info">
									<span class="pf-row-label">
										{{ acct.username }} @ {{ gridStore.grids.find(g => g.nick === acct.gridNick)?.name ?? acct.gridNick }}
									</span>
									<span class="pf-row-hint">Last used: {{ formatLastUsed(acct.lastUsed) }}</span>
								</div>
								<button
									class="px-3 py-1 text-sm rounded border border-red-500/40 text-red-400 hover:bg-red-500/15 transition-colors"
									@click="accountsStore.remove(acct.username, acct.gridNick)"
								>Remove</button>
							</div>
						</template>
						<p v-else class="text-t2 text-sm px-1">
							No saved accounts. Check &ldquo;Remember me&rdquo; when logging in.
						</p>
					</template>

					<!-- ── GENERAL ── -->
					<template v-else-if="activeTab === 'general'">
						<h2 class="pf-section-heading">General</h2>

						<div class="pf-row">
							<div class="pf-row-info">
								<span class="pf-row-label">Display Name</span>
								<span class="pf-row-hint">Avatar name shown to others in-world.</span>
							</div>
							<span class="pf-value-readonly">{{ avatarStore.displayName || '—' }}</span>
						</div>

						<div class="pf-row pf-row--disabled">
							<div class="pf-row-info">
								<span class="pf-row-label">Interface Language</span>
								<span class="pf-row-hint">UI language. Only English available now.</span>
							</div>
							<span class="pf-chip-soon">Coming soon</span>
						</div>

						<div class="pf-row pf-row--disabled">
							<div class="pf-row-info">
								<span class="pf-row-label">Show welcome screen on login</span>
								<span class="pf-row-hint">Display splash overlay when entering a region.</span>
							</div>
							<span class="pf-chip-soon">Coming soon</span>
						</div>
					</template>

					<!-- ── APPEARANCE ── -->
					<template v-else-if="activeTab === 'appearance'">
						<h2 class="pf-section-heading">Appearance</h2>

						<div class="pf-row">
							<div class="pf-row-info">
								<span class="pf-row-label">Theme</span>
								<span class="pf-row-hint">Night (dark) or Day (light) mode. Cancel reverts.</span>
							</div>
							<button
								class="theme-toggle"
								:class="{ dark: theme.isDark.value }"
								:title="theme.isDark.value ? 'Light mode' : 'Dark mode'"
								@click="theme.toggle()"
							>
								<span class="theme-knob" />
								<span class="theme-label">{{ theme.isDark.value ? '☀ Light mode' : '🌙 Dark mode' }}</span>
							</button>
						</div>

						<div class="pf-row pf-row--disabled">
							<div class="pf-row-info">
								<span class="pf-row-label">UI Density</span>
								<span class="pf-row-hint">Compact or comfortable spacing.</span>
							</div>
							<span class="pf-chip-soon">Coming soon</span>
						</div>

						<div class="pf-row pf-row--disabled">
							<div class="pf-row-info">
								<span class="pf-row-label">Font Size</span>
								<span class="pf-row-hint">Scale chat and UI text.</span>
							</div>
							<span class="pf-chip-soon">Coming soon</span>
						</div>
					</template>

					<!-- ── CHAT (soon) ── -->
					<template v-else-if="activeTab === 'chat'">
						<h2 class="pf-section-heading">Chat</h2>
						<div class="pf-soon-block">
							<span class="pf-soon-icon">💬</span>
							<p>Chat preferences coming in a future update.</p>
							<ul class="pf-soon-list">
								<li>Nearby chat range (slider)</li>
								<li>Show timestamps</li>
								<li>Chat font size</li>
								<li>Chat bubble style</li>
							</ul>
						</div>
					</template>

					<!-- ── GRAPHICS (soon) ── -->
					<template v-else-if="activeTab === 'graphics'">
						<h2 class="pf-section-heading">Graphics</h2>
						<div class="pf-soon-block">
							<span class="pf-soon-icon">🖥️</span>
							<p>Graphics settings coming in a future update.</p>
							<ul class="pf-soon-list">
								<li>Draw distance</li>
								<li>Avatar LOD factor</li>
								<li>Max visible avatars</li>
								<li>Particle count limit</li>
							</ul>
						</div>
					</template>

					<!-- ── SOUND & MEDIA ── -->
					<template v-else-if="activeTab === 'sound'">
						<h2 class="pf-section-heading">Sound &amp; Media</h2>

						<!-- Horizontal sub-tabs -->
						<div class="flex gap-1 mb-4 border-b border-brd pb-2">
							<button
								v-for="st in soundSubTabs" :key="st.id"
								class="px-3 py-1 text-xs rounded-t font-semibold transition-colors"
								:class="activeSoundTab === st.id
									? 'bg-card2 text-accent border border-brd border-b-card2 -mb-px'
									: 'text-tm hover:text-t2'"
								@click="activeSoundTab = st.id"
							>{{ st.label }}</button>
						</div>

						<!-- Sounds sub-tab -->
						<template v-if="activeSoundTab === 'sounds'">

							<!-- Volume mixer -->
							<div class="flex flex-col gap-3 mb-6">
								<h3 class="text-xs font-bold uppercase tracking-widest text-tm">Volume</h3>

								<!-- Master (wired) -->
								<div class="pf-row">
									<div class="pf-row-info">
										<span class="pf-row-label">Master</span>
										<span class="pf-row-hint">Overall volume for all sounds.</span>
									</div>
									<div class="flex items-center gap-2">
										<input type="range" min="0" max="100"
											:value="toSlider(masterVolume)"
											@input="fromSlider($event, masterVolume)"
											class="w-28 accent-accent" />
										<button
											class="text-xs w-6 h-6 flex items-center justify-center rounded hover:bg-white/10"
											:class="isAllAudioMuted ? 'text-red-400' : 'text-t2'"
											@click="toggleAllAudioMute"
											:title="isAllAudioMuted ? 'Unmute' : 'Mute'"
										>{{ isAllAudioMuted ? '🔇' : '🔊' }}</button>
									</div>
								</div>

								<!-- Interface (wired) -->
								<div class="pf-row">
									<div class="pf-row-info">
										<span class="pf-row-label">Interface</span>
										<span class="pf-row-hint">UI sounds — pops, notifications, teleport.</span>
									</div>
									<div class="flex items-center gap-2">
										<input type="range" min="0" max="100"
											:value="toSlider(interfaceVolume)"
											@input="fromSlider($event, interfaceVolume)"
											class="w-28 accent-accent" />
										<button
											class="text-xs w-6 h-6 flex items-center justify-center rounded hover:bg-white/10"
											:class="interfaceMuted ? 'text-red-400' : 'text-t2'"
											@click="interfaceMuted = !interfaceMuted"
											:title="interfaceMuted ? 'Unmute' : 'Mute'"
										>{{ interfaceMuted ? '🔇' : '🔊' }}</button>
									</div>
								</div>

								<!-- Stub rows -->
								<div v-for="row in soundStubRows" :key="row.label" class="pf-row opacity-50">
									<div class="pf-row-info">
										<span class="pf-row-label">{{ row.label }}</span>
										<span class="pf-row-hint">{{ row.hint }}</span>
									</div>
									<div class="flex items-center gap-2">
										<input type="range" min="0" max="100" value="75" disabled class="w-28" />
										<span class="pf-chip-soon">soon</span>
									</div>
								</div>
							</div>

							<!-- Audio devices -->
							<div class="flex flex-col gap-3">
								<h3 class="text-xs font-bold uppercase tracking-widest text-tm">Devices</h3>

								<p v-if="!micDevices.length && !spkDevices.length" class="text-xs text-tm">
									Open voice to enumerate devices.
								</p>

								<div v-if="micDevices.length" class="pf-row">
									<div class="pf-row-info">
										<span class="pf-row-label">Microphone</span>
										<span class="pf-row-hint">Input device for voice chat.</span>
									</div>
									<select
										class="bg-card2 border border-brd2 rounded text-xs text-t1 px-2 py-1 cursor-pointer focus:outline-none focus:border-accent"
										:value="voice.selectedMicId.value"
										@change="voice.setMicDevice?.($event.target.value)"
									>
										<option v-for="d in micDevices" :key="d.deviceId" :value="d.deviceId">
											{{ d.label || `Microphone ${d.deviceId.slice(0,6)}` }}
										</option>
									</select>
								</div>

								<div v-if="spkDevices.length" class="pf-row">
									<div class="pf-row-info">
										<span class="pf-row-label">Speaker</span>
										<span class="pf-row-hint">
											Output device for voice.
											<span v-if="!canSetSink" class="text-yellow-500/70">Use system audio settings.</span>
										</span>
									</div>
									<select
										class="bg-card2 border border-brd2 rounded text-xs text-t1 px-2 py-1 cursor-pointer focus:outline-none focus:border-accent"
										:value="voice.selectedSpkId.value"
										@change="voice.setSpeakerDevice?.($event.target.value)"
										:disabled="!canSetSink"
										:class="{ 'opacity-40 cursor-not-allowed': !canSetSink }"
									>
										<option v-for="d in spkDevices" :key="d.deviceId" :value="d.deviceId">
											{{ d.label || `Speaker ${d.deviceId.slice(0,6)}` }}
										</option>
									</select>
								</div>
							</div>

						</template>

						<!-- Music stub -->
						<template v-else-if="activeSoundTab === 'music'">
							<div class="pf-soon-block">
								<span class="pf-soon-icon">🎵</span>
								<p>Parcel music streaming coming in a future update.</p>
							</div>
						</template>

						<!-- Media stub -->
						<template v-else-if="activeSoundTab === 'media'">
							<div class="pf-soon-block">
								<span class="pf-soon-icon">📺</span>
								<p>In-world media (video streams) coming in a future update.</p>
							</div>
						</template>

						<!-- Voice stub -->
						<template v-else-if="activeSoundTab === 'voice'">
							<div class="pf-soon-block">
								<span class="pf-soon-icon">🎙️</span>
								<p>Voice device settings are in the <strong>Sounds</strong> tab above.</p>
							</div>
						</template>

					</template>

					<!-- ── OPENSIM (soon) ── -->
					<template v-else-if="activeTab === 'opensim'">
						<h2 class="pf-section-heading">OpenSim</h2>
						<div class="pf-soon-block">
							<span class="pf-soon-icon">🌐</span>
							<p>OpenSim-specific settings coming in a future update.</p>
							<ul class="pf-soon-list">
								<li>Custom login URI</li>
								<li>Grid profile management</li>
								<li>Export / import settings</li>
							</ul>
						</div>
					</template>

					<!-- ── SEARCH EMPTY STATE ── -->
					<template v-else-if="visibleTabs.length === 0">
						<div class="pf-empty">
							No settings match "<strong>{{ search }}</strong>"
						</div>
					</template>

				</div><!-- /pf-content -->
			</div><!-- /pf-body -->

			<!-- ── Footer ────────────────────────────────────────────────── -->
			<div class="pf-footer">
				<button class="pf-btn pf-btn--cancel" @click="cancel">Cancel</button>
				<button class="pf-btn pf-btn--ok"     @click="ok">OK</button>
			</div>

	</FloaterWindow>
</template>

<style scoped>
/* ── Search ──────────────────────────────────────────────────────────────── */
.pf-searchbar {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	padding: 0.5rem 1rem;
	border-bottom: 1px solid var(--color-brd);
	flex-shrink: 0;
}

.pf-search-icon { color: var(--color-tm); flex-shrink: 0; }

.pf-search-input {
	flex: 1;
	background: none;
	border: none;
	outline: none;
	color: var(--color-t1);
	font-size: 0.8125rem;
}
.pf-search-input::placeholder { color: var(--color-tm); }

/* ── Body ────────────────────────────────────────────────────────────────── */
.pf-body {
	display: flex;
	flex: 1;
	min-height: 0;
}

/* ── Tab nav ─────────────────────────────────────────────────────────────── */
.pf-tabnav {
	display: flex;
	flex-direction: column;
	width: 11rem;
	flex-shrink: 0;
	border-right: 1px solid var(--color-brd);
	overflow-y: auto;
	padding: 0.375rem 0;
}

.pf-tab {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	padding: 0.5rem 0.75rem;
	background: none;
	border: none;
	border-left: 2px solid transparent;
	cursor: pointer;
	text-align: left;
	transition: background 0.12s, color 0.12s;
	color: var(--color-tm);
	font-size: 0.8rem;
	line-height: 1.2;
}
.pf-tab:hover:not(.pf-tab--disabled) {
	background: rgba(255, 255, 255, 0.05);
	color: var(--color-t2);
}
.pf-tab--active {
	background: rgba(255, 255, 255, 0.08);
	border-left-color: var(--color-accent);
	color: var(--color-accent);
}
.pf-tab--disabled {
	opacity: 0.35;
	cursor: not-allowed;
}

.pf-tab-icon  { font-size: 0.9rem; flex-shrink: 0; }
.pf-tab-label { flex: 1; }

.pf-tab-badge {
	font-size: 0.5rem;
	letter-spacing: 0.04em;
	text-transform: uppercase;
	color: var(--color-tm);
	background: var(--color-card2);
	border: 1px solid var(--color-brd2);
	border-radius: 0.25rem;
	padding: 0.0625rem 0.25rem;
	flex-shrink: 0;
}

/* ── Content area ────────────────────────────────────────────────────────── */
.pf-content {
	flex: 1;
	overflow-y: auto;
	padding: 1rem 1.25rem;
	display: flex;
	flex-direction: column;
	gap: 0.25rem;
}

.pf-section-heading {
	font-size: 0.6875rem;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.08em;
	color: var(--color-tm);
	margin-bottom: 0.5rem;
}

/* ── Row ──────────────────────────────────────────────────────────────────── */
.pf-row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 1rem;
	padding: 0.35rem 0;
	border-bottom: 1px solid var(--color-brd);
}
.pf-row:last-child { border-bottom: none; }
.pf-row--disabled  { opacity: 0.4; }

.pf-row-info  { display: flex; flex-direction: column; gap: 0.2rem; flex: 1; }
.pf-row-label { font-size: 0.8125rem; font-weight: 500; color: var(--color-t1); }
.pf-row-hint  { font-size: 0.625rem; color: var(--color-tm); line-height: 1.45; }

.pf-value-readonly {
	font-size: 0.8125rem;
	color: var(--color-t2);
	font-family: monospace;
	flex-shrink: 0;
}

.pf-chip-soon {
	font-size: 0.6rem;
	text-transform: uppercase;
	letter-spacing: 0.05em;
	color: var(--color-tm);
	background: var(--color-card2);
	border: 1px solid var(--color-brd2);
	border-radius: 0.25rem;
	padding: 0.125rem 0.375rem;
	flex-shrink: 0;
}

/* ── Theme toggle ─────────────────────────────────────────────────────────── */
.theme-toggle {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	background: var(--color-card2);
	border: 1px solid var(--color-brd2);
	border-radius: 2rem;
	padding: 0.3125rem 0.75rem 0.3125rem 0.3125rem;
	cursor: pointer;
	transition: background 0.2s, border-color 0.2s;
	flex-shrink: 0;
}
.theme-toggle:hover { border-color: var(--color-accent); }

.theme-knob {
	width: 1.125rem;
	height: 1.125rem;
	border-radius: 50%;
	background: var(--color-tm);
	transition: background 0.2s;
	flex-shrink: 0;
}
.theme-toggle.dark .theme-knob { background: var(--color-accent3); }

.theme-label {
	font-size: 0.75rem;
	font-weight: 600;
	color: var(--color-t2);
	white-space: nowrap;
}

/* ── Coming soon block ────────────────────────────────────────────────────── */
.pf-soon-block {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 0.75rem;
	padding: 2rem 1rem;
	color: var(--color-tm);
	font-size: 0.8125rem;
	text-align: center;
}
.pf-soon-icon { font-size: 2rem; }
.pf-soon-list {
	list-style: disc;
	text-align: left;
	font-size: 0.75rem;
	color: var(--color-tm);
	padding-left: 1.25rem;
	line-height: 1.8;
}

/* ── Empty state ──────────────────────────────────────────────────────────── */
.pf-empty {
	padding: 2rem;
	color: var(--color-tm);
	font-size: 0.8125rem;
	text-align: center;
}

/* ── Footer ──────────────────────────────────────────────────────────────── */
.pf-footer {
	display: flex;
	align-items: center;
	justify-content: flex-end;
	gap: 0.5rem;
	padding: 0.625rem 1rem;
	border-top: 1px solid var(--color-brd);
	flex-shrink: 0;
}

.pf-btn {
	border-radius: 0.375rem;
	font-size: 0.8125rem;
	font-weight: 600;
	padding: 0.375rem 1.125rem;
	cursor: pointer;
	transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.pf-btn--cancel {
	background: none;
	border: 1px solid var(--color-brd2);
	color: var(--color-t2);
}
.pf-btn--cancel:hover { border-color: var(--color-brd); color: var(--color-t1); }
.pf-btn--ok {
	background: var(--color-accent);
	border: 1px solid transparent;
	color: #fff;
}
.pf-btn--ok:hover { filter: brightness(1.1); }
</style>
