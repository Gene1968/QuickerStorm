<script setup>
/**
 * WhiteboardToolbar — Tool selection bar for the whiteboard.
 *
 * Tools: select (pointer), pen (freehand), sticky note, shape, eraser.
 * Also includes color pickers and clear-all action.
 */
import { ref } from 'vue'
import { STICKY_COLORS } from '@/composables/useWhiteboard.js'

const props = defineProps({
	activeTool: { type: String, default: 'select' },
	penColor: { type: String, default: '#1e293b' },
	penWidth: { type: Number, default: 3 },
	stickyColor: { type: String, default: '#fef08a' },
})

const emit = defineEmits([
	'tool-change', 'add-sticky', 'add-shape', 'clear-all',
	'update:pen-color', 'update:pen-width', 'update:sticky-color',
])

const showColorPicker = ref(false)
const showShapeMenu = ref(false)

const PEN_COLORS = ['#1e293b', '#dc2626', '#2563eb', '#16a34a', '#9333ea', '#ca8a04']
const PEN_WIDTHS = [2, 4, 6, 10]

function selectTool(tool) {
	showColorPicker.value = false
	showShapeMenu.value = false
	emit('tool-change', tool)
}

function toggleColorPicker() {
	showColorPicker.value = !showColorPicker.value
	showShapeMenu.value = false
}

function toggleShapeMenu() {
	showShapeMenu.value = !showShapeMenu.value
	showColorPicker.value = false
}

function selectPenColor(color) {
	emit('update:pen-color', color)
}

function selectStickyColor(color) {
	emit('update:sticky-color', color)
	emit('add-sticky')
	showColorPicker.value = false
}
</script>

<template>
	<div class="wb-toolbar">
		<!-- Select tool -->
		<button
			class="tool-btn"
			:class="{ active: activeTool === 'select' }"
			@click="selectTool('select')"
			title="Select (V)"
		>
			<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/>
			</svg>
		</button>

		<!-- Pen tool -->
		<button
			class="tool-btn"
			:class="{ active: activeTool === 'pen' }"
			@click="selectTool('pen')"
			title="Pen (P)"
		>
			<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path d="M12 19l7-7 3 3-7 7-3-3z"/>
				<path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/>
			</svg>
		</button>

		<!-- Pen color/width picker -->
		<div class="tool-group" v-if="activeTool === 'pen'">
			<div
				class="color-swatch"
				:style="{ background: penColor }"
				@click="toggleColorPicker"
			/>
			<div v-if="showColorPicker" class="dropdown pen-dropdown">
				<div class="dropdown-section">
					<span class="dropdown-label">Color</span>
					<div class="color-row">
						<button
							v-for="c in PEN_COLORS" :key="c"
							class="color-btn"
							:class="{ selected: penColor === c }"
							:style="{ background: c }"
							@click="selectPenColor(c)"
						/>
					</div>
				</div>
				<div class="dropdown-section">
					<span class="dropdown-label">Width</span>
					<div class="width-row">
						<button
							v-for="w in PEN_WIDTHS" :key="w"
							class="width-btn"
							:class="{ selected: penWidth === w }"
							@click="emit('update:pen-width', w)"
						>
							<span class="width-preview" :style="{ width: w + 'px', height: w + 'px' }"/>
						</button>
					</div>
				</div>
			</div>
		</div>

		<div class="toolbar-divider" />

		<!-- Sticky note -->
		<button class="tool-btn" @click="emit('add-sticky')" title="Add Sticky (S)">
			<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<rect x="3" y="3" width="18" height="18" rx="2"/>
				<path d="M15 3v6a2 2 0 002 2h6"/>
			</svg>
		</button>

		<!-- Shape -->
		<button
			class="tool-btn"
			:class="{ active: showShapeMenu }"
			@click="toggleShapeMenu"
			title="Shape"
		>
			<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<rect x="3" y="3" width="18" height="18" rx="2"/>
			</svg>
		</button>

		<div v-if="showShapeMenu" class="dropdown shape-dropdown">
			<button class="dropdown-item" @click="emit('add-shape', 'rect'); showShapeMenu = false">Rectangle</button>
			<button class="dropdown-item" @click="emit('add-shape', 'circle'); showShapeMenu = false">Circle</button>
			<button class="dropdown-item" @click="emit('add-shape', 'line'); showShapeMenu = false">Line</button>
		</div>

		<div class="toolbar-divider" />

		<!-- Eraser -->
		<button
			class="tool-btn"
			:class="{ active: activeTool === 'eraser' }"
			@click="selectTool('eraser')"
			title="Eraser (E)"
		>
			<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path d="M20 20H7L3 16l9-9 8 8-4 4"/>
				<path d="M6.5 13.5l5-5"/>
			</svg>
		</button>

		<div class="toolbar-spacer" />

		<!-- Clear all -->
		<button class="tool-btn danger" @click="emit('clear-all')" title="Clear All">
			<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<polyline points="3 6 5 6 21 6"/>
				<path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
			</svg>
		</button>
	</div>
</template>

<style scoped>
.wb-toolbar {
	display: flex;
	align-items: center;
	gap: 4px;
	padding: 6px 12px;
	background: #fff;
	border-bottom: 1px solid #e2e8f0;
	flex-shrink: 0;
	position: relative;
}

.tool-btn {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 34px;
	height: 34px;
	border: none;
	border-radius: 6px;
	background: transparent;
	color: #475569;
	cursor: pointer;
	transition: background 0.1s, color 0.1s;
}
.tool-btn:hover { background: #f1f5f9; color: #1e293b; }
.tool-btn.active { background: #e0e7ff; color: #3b82f6; }
.tool-btn.danger:hover { background: #fee2e2; color: #dc2626; }

.toolbar-divider {
	width: 1px;
	height: 24px;
	background: #e2e8f0;
	margin: 0 4px;
}

.toolbar-spacer { flex: 1; }

.tool-group {
	position: relative;
	display: flex;
	align-items: center;
}

.color-swatch {
	width: 20px;
	height: 20px;
	border-radius: 50%;
	cursor: pointer;
	border: 2px solid #e2e8f0;
}

.dropdown {
	position: absolute;
	top: 100%;
	left: 0;
	margin-top: 4px;
	background: #fff;
	border: 1px solid #e2e8f0;
	border-radius: 8px;
	padding: 8px;
	box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
	z-index: 100;
}

.shape-dropdown {
	top: 100%;
	left: 50%;
	transform: translateX(-50%);
	margin-top: 6px;
}

.dropdown-section { margin-bottom: 8px; }
.dropdown-section:last-child { margin-bottom: 0; }
.dropdown-label { font-size: 11px; color: #64748b; margin-bottom: 4px; display: block; }

.color-row, .width-row { display: flex; gap: 4px; }

.color-btn {
	width: 22px;
	height: 22px;
	border-radius: 50%;
	border: 2px solid transparent;
	cursor: pointer;
}
.color-btn.selected { border-color: #3b82f6; }

.width-btn {
	width: 28px;
	height: 28px;
	display: flex;
	align-items: center;
	justify-content: center;
	border: 1px solid #e2e8f0;
	border-radius: 4px;
	background: #fff;
	cursor: pointer;
}
.width-btn.selected { border-color: #3b82f6; background: #eff6ff; }

.width-preview {
	border-radius: 50%;
	background: #1e293b;
}

.dropdown-item {
	display: block;
	width: 100%;
	padding: 6px 12px;
	border: none;
	background: none;
	text-align: left;
	cursor: pointer;
	border-radius: 4px;
	font-size: 13px;
	color: #334155;
}
.dropdown-item:hover { background: #f1f5f9; }
</style>
