<script setup>
/**
 * QuickPrefs — quick-access preferences, now a standard draggable FloaterWindow.
 * Opens docked at bottom-right above the toolbar with a down-caret pointing at its trigger button;
 * drag it and the caret is replaced by a Dock button (in the titlebar) to snap it back.
 * Post-login only (mounted in BottomToolbar context).
 */
import FloaterWindow from '@/components/FloaterWindow.vue'
import { useTheme } from '@/composables/useTheme.js'
import { useUiStore } from '@/stores/uiStore.js'

const theme = useTheme()
const ui    = useUiStore()

function close() { ui.showQuickPrefs = false }

function openPreferences() {
	close()
	ui.openPreferences()
}
</script>

<template>
	<FloaterWindow
		id="quickprefs"
		title="Quick Preferences"
		:wrap-style="{ width: '18rem' }"
		:default-pos="{ right: '1.25rem', bottom: '2.9rem' }"
		caret-dir="down"
		@close="close"
	>
		<!-- ── Theme ─────────────────────────────────────────────────── -->
		<div class="qp-section">
			<div class="qp-section-label">Appearance</div>

			<div class="qp-row">
				<span class="qp-row-label">Theme</span>
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
		</div>

		<!-- ── Graphics ─────────────────────────────────────────────── -->
		<div class="qp-section">
			<div class="qp-section-label">Graphics</div>

			<!-- Lit shading (default ON): FS-parity sun/ambient shading on prims vs flat unlit. -->
			<div class="qp-row">
				<span class="qp-row-label">Lit Shading</span>
				<button
					class="theme-toggle"
					:class="{ dark: ui.litShading }"
					:title="ui.litShading ? 'Disable lit shading (flat unlit colors)' : 'Enable FS-parity lit shading'"
					@click="ui.litShading = !ui.litShading"
				>
					<span class="theme-knob" />
					<span class="theme-label">{{ ui.litShading ? 'On' : 'Off' }}</span>
				</button>
			</div>

			<div class="qp-row qp-row--disabled">
				<span class="qp-row-label">Draw Distance</span>
				<div class="qp-slider-wrap">
					<input type="range" min="32" max="512" step="8" value="128" disabled class="qp-slider" />
					<span class="qp-slider-val">128m</span>
				</div>
			</div>

			<div class="qp-row qp-row--disabled">
				<span class="qp-row-label">Name Tags</span>
				<select class="qp-select" disabled>
					<option>Default</option>
					<option>Always</option>
					<option>None</option>
				</select>
			</div>
		</div>

		<!-- ── Footer link ───────────────────────────────────────────── -->
		<div class="qp-footer">
			<button class="qp-prefs-link" @click="openPreferences">
				⚙️ Open Preferences… <span class="qp-kbhint">Ctrl+P</span>
			</button>
		</div>
	</FloaterWindow>
</template>

<style scoped>
/* ── Sections ────────────────────────────────────────────────────────────── */
.qp-section {
	display: flex;
	flex-direction: column;
	gap: 0.25rem;
	padding: 0.5rem 0.875rem;
	border-bottom: 1px solid var(--edge);
}
.qp-section-label {
	font-size: 0.5625rem;
	font-weight: 700;
	color: var(--fg-muted);
	letter-spacing: 0.08em;
	text-transform: uppercase;
	margin-bottom: 0.125rem;
}

/* ── Row ─────────────────────────────────────────────────────────────────── */
.qp-row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.75rem;
	padding: 0.25rem 0;
}
.qp-row--disabled { opacity: 0.35; pointer-events: none; }
.qp-row-label { font-size: 0.75rem; color: var(--fg-subtle); white-space: nowrap; flex-shrink: 0; }

/* ── Theme toggle ─────────────────────────────────────────────────────────── */
.theme-toggle {
	display: flex;
	align-items: center;
	gap: 0.4rem;
	background: var(--panel-alt);
	border: 1px solid var(--edge-strong);
	border-radius: 2rem;
	padding: 0.25rem 0.65rem 0.25rem 0.5rem;
	cursor: pointer;
	transition: background 0.2s, border-color 0.2s;
	flex-shrink: 0;
}
.theme-toggle:hover { border-color: var(--accent); }
.theme-knob {
	width: 0.875rem;
	height: 0.875rem;
	border-radius: 50%;
	background: var(--fg-muted);
	transition: background 0.2s;
	flex-shrink: 0;
}
.theme-toggle.dark .theme-knob { background: var(--accent-light); }
.theme-label { font-size: 0.6875rem; font-weight: 600; color: var(--fg-subtle); white-space: nowrap; }

/* ── Slider ──────────────────────────────────────────────────────────────── */
.qp-slider-wrap { display: flex; align-items: center; gap: 0.375rem; flex-shrink: 0; }
.qp-slider { width: 6rem; accent-color: var(--accent); }
.qp-slider-val { font-size: 0.6875rem; color: var(--fg-muted); width: 2.5rem; text-align: right; }

/* ── Select ──────────────────────────────────────────────────────────────── */
.qp-select {
	background: var(--panel-alt);
	border: 1px solid var(--edge-strong);
	border-radius: 0.3125rem;
	color: var(--fg-subtle);
	font-size: 0.6875rem;
	padding: 0.2rem 0.4rem;
	cursor: pointer;
}

/* ── Footer ──────────────────────────────────────────────────────────────── */
.qp-footer {
	padding: 0.4rem 0.5rem;
}
.qp-prefs-link {
	width: 100%;
	background: none;
	border: none;
	color: var(--accent);
	font-size: 0.75rem;
	font-weight: 500;
	padding: 0.3rem 0.375rem;
	border-radius: 0.3125rem;
	cursor: pointer;
	display: flex;
	align-items: center;
	gap: 0.5rem;
	transition: background 0.12s;
	text-align: left;
}
.qp-prefs-link:hover { background: rgba(255, 255, 255, 0.06); }
.qp-kbhint {
	margin-left: auto;
	font-size: 0.5625rem;
	color: var(--fg-muted);
	background: var(--panel-alt);
	border: 1px solid var(--edge-strong);
	border-radius: 0.25rem;
	padding: 0.1rem 0.3rem;
	font-family: monospace;
}
</style>
