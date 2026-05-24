<script setup>
/**
 * QuickPrefsPopover — quick-access preferences panel, FS-style.
 * Anchored fixed above the bottom toolbar, right-aligned.
 * Down-arrow caret points toward the trigger button.
 * Post-login only (mounted in BottomToolbar context).
 */
import { onMounted, onUnmounted } from 'vue'
import { useTheme } from '@/composables/useTheme.js'
import { useUiStore } from '@/stores/uiStore.js'

const theme = useTheme()
const ui    = useUiStore()

function close() { ui.showQuickPrefs = false }

function openPreferences() {
	close()
	ui.openPreferences()
}

function onKey(e) {
	if (e.key === 'Escape') close()
}

function onClickOutside(e) {
	// The trigger button has data-quick-prefs-trigger; don't close on that click
	if (e.target.closest('[data-quick-prefs-trigger]')) return
	if (!e.target.closest('.qp-popover')) close()
}

onMounted(() => {
	window.addEventListener('keydown', onKey)
	// Defer so the opening click doesn't immediately close it
	setTimeout(() => window.addEventListener('mousedown', onClickOutside), 50)
})
onUnmounted(() => {
	window.removeEventListener('keydown', onKey)
	window.removeEventListener('mousedown', onClickOutside)
})
</script>

<template>
	<!--
		Fixed above bottom bar (bottom: 40px = toolbar height).
		Right edge: 0.5rem from viewport right.
		Down-caret at bottom-right of popover via ::after pseudo.
	-->
	<div class="qp-popover" role="dialog" aria-label="Quick Preferences">

		<!-- Header -->
		<div class="qp-header">
			<span class="qp-title">Quick Preferences</span>
			<button class="qp-close" title="Close" @click="close">✕</button>
		</div>

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

		<!-- ── Graphics (placeholder) ───────────────────────────────── -->
		<div class="qp-section">
			<div class="qp-section-label">Graphics</div>

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

		<!-- Down caret pointing toward trigger button -->
		<div class="qp-caret" />

	</div>
</template>

<style scoped>
.qp-popover {
	position: fixed;
	bottom: 44px; /* toolbar height + gap */
	right: 0.5rem;
	width: clamp(14rem, 22vw, 20rem);
	background: var(--color-card);
	border: 1px solid var(--color-brd2);
	border-radius: 0.625rem;
	box-shadow: 0 8px 32px rgba(0, 0, 0, 0.55);
	display: flex;
	flex-direction: column;
	z-index: 650;
	overflow: visible; /* caret needs to overflow */
}

/* ── Down caret ──────────────────────────────────────────────────────────── */
.qp-caret {
	position: absolute;
	bottom: -7px;
	right: 1.5rem; /* align with the button */
	width: 14px;
	height: 7px;
	overflow: visible;
}
.qp-caret::before,
.qp-caret::after {
	content: '';
	position: absolute;
	left: 0;
}
/* border triangle (border color) */
.qp-caret::before {
	bottom: -1px;
	border-left: 7px solid transparent;
	border-right: 7px solid transparent;
	border-top: 8px solid var(--color-brd2);
}
/* fill triangle (background color) */
.qp-caret::after {
	bottom: 0;
	border-left: 7px solid transparent;
	border-right: 7px solid transparent;
	border-top: 7px solid var(--color-card);
}

/* ── Header ──────────────────────────────────────────────────────────────── */
.qp-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 0.6rem 0.875rem 0.5rem;
	border-bottom: 1px solid var(--color-brd);
}
.qp-title {
	font-size: 0.8125rem;
	font-weight: 700;
	color: var(--color-t1);
	letter-spacing: 0.01em;
}
.qp-close {
	background: none;
	border: none;
	cursor: pointer;
	color: var(--color-tm);
	font-size: 0.75rem;
	padding: 0.125rem 0.25rem;
	border-radius: 0.25rem;
	transition: color 0.15s;
}
.qp-close:hover { color: var(--color-t1); }

/* ── Sections ────────────────────────────────────────────────────────────── */
.qp-section {
	display: flex;
	flex-direction: column;
	gap: 0.25rem;
	padding: 0.5rem 0.875rem;
	border-bottom: 1px solid var(--color-brd);
}
.qp-section-label {
	font-size: 0.5625rem;
	font-weight: 700;
	color: var(--color-tm);
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
.qp-row-label { font-size: 0.75rem; color: var(--color-t2); white-space: nowrap; flex-shrink: 0; }

/* ── Theme toggle ─────────────────────────────────────────────────────────── */
.theme-toggle {
	display: flex;
	align-items: center;
	gap: 0.4rem;
	background: var(--color-card2);
	border: 1px solid var(--color-brd2);
	border-radius: 2rem;
	padding: 0.25rem 0.625rem 0.25rem 0.25rem;
	cursor: pointer;
	transition: background 0.2s, border-color 0.2s;
	flex-shrink: 0;
}
.theme-toggle:hover { border-color: var(--color-accent); }
.theme-knob {
	width: 0.875rem;
	height: 0.875rem;
	border-radius: 50%;
	background: var(--color-tm);
	transition: background 0.2s;
	flex-shrink: 0;
}
.theme-toggle.dark .theme-knob { background: var(--color-accent3); }
.theme-label { font-size: 0.6875rem; font-weight: 600; color: var(--color-t2); white-space: nowrap; }

/* ── Slider ──────────────────────────────────────────────────────────────── */
.qp-slider-wrap { display: flex; align-items: center; gap: 0.375rem; flex-shrink: 0; }
.qp-slider { width: 6rem; accent-color: var(--color-accent); }
.qp-slider-val { font-size: 0.6875rem; color: var(--color-tm); width: 2.5rem; text-align: right; }

/* ── Select ──────────────────────────────────────────────────────────────── */
.qp-select {
	background: var(--color-card2);
	border: 1px solid var(--color-brd2);
	border-radius: 0.3125rem;
	color: var(--color-t2);
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
	color: var(--color-accent);
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
	color: var(--color-tm);
	background: var(--color-card2);
	border: 1px solid var(--color-brd2);
	border-radius: 0.25rem;
	padding: 0.1rem 0.3rem;
	font-family: monospace;
}
</style>
