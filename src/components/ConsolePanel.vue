<script setup>
import { ref, onMounted, onUnmounted, nextTick, h } from 'vue'
import { X as XMarkIcon, ChevronRight as ChevronRightIcon, ChevronDown as ChevronDownIcon } from '@lucide/vue'
import { useModalAudio } from '@/composables/useModalAudio.js'
useModalAudio()

const isVisible = ref(false)
const messages = ref([])
const maxMessages = 1000 // Limit to prevent memory issues
const originalConsole = {}
const expandedPaths = ref(new Set()) // Track which object paths are expanded

// Console method types for styling with more vibrant colors
const consoleTypes = {
	log: { label: 'LOG', color: '#1a1a1a', bgColor: '#e8e8e8', borderColor: '#6c757d' },
	info: { label: 'INFO', color: '#004085', bgColor: '#cce5ff', borderColor: '#0dcaf0' },
	warn: { label: 'WARN', color: '#856404', bgColor: '#fff3cd', borderColor: '#ffc107' },
	error: { label: 'ERROR', color: '#721c24', bgColor: '#f8d7da', borderColor: '#dc3545' },
	debug: { label: 'DEBUG', color: '#4a148c', bgColor: '#e1bee7', borderColor: '#6f42c1' },
	trace: { label: 'TRACE', color: '#1a1a1a', bgColor: '#e8e8e8', borderColor: '#6c757d' },
}

// Store original console methods
const methodsToIntercept = ['log', 'info', 'warn', 'error', 'debug', 'trace']
methodsToIntercept.forEach(method => {
	originalConsole[method] = console[method].bind(console)
})

// Toggle expanded state for a path
const toggleExpanded = (path) => {
	if (expandedPaths.value.has(path)) {
		expandedPaths.value.delete(path)
	} else {
		expandedPaths.value.add(path)
	}
}

// Check if a path is expanded
const isExpanded = (path) => {
	return expandedPaths.value.has(path)
}

// Add a message to the console panel
const addMessage = (type, args) => {
	const timestamp = new Date().toLocaleTimeString()

	messages.value.push({
		id: Date.now() + Math.random(),
		type,
		args,
		timestamp,
		raw: args
	})

	// Limit message count
	if (messages.value.length > maxMessages) {
		messages.value.shift()
	}

	// Auto-scroll to bottom if panel is visible
	if (isVisible.value) {
		nextTick(() => {
			const container = document.getElementById('console-messages')
			if (container) {
				container.scrollTop = container.scrollHeight
			}
		})
	}
}

// Intercept console methods
const interceptConsole = () => {
	methodsToIntercept.forEach(method => {
		console[method] = (...args) => {
			// Call original console method
			originalConsole[method](...args)
			// Add to our panel
			addMessage(method, args)
		}
	})
}

// Restore original console methods
const restoreConsole = () => {
	methodsToIntercept.forEach(method => {
		console[method] = originalConsole[method]
	})
}

const scrollConsoleToBottom = () => {
	nextTick(() => {
		const container = document.getElementById('console-messages')
		if (container) {
			container.scrollTop = container.scrollHeight
		}
	})
}

// Toggle console panel visibility
const toggleConsole = () => {
	isVisible.value = !isVisible.value
	if (isVisible.value) {
		scrollConsoleToBottom()
	}
}

/** Open panel (e.g. from Corner menu); exposed to App.vue via ref */
const openConsole = () => {
	isVisible.value = true
	scrollConsoleToBottom()
}

defineExpose({ openConsole })

// Clear console messages
const clearConsole = () => {
	messages.value = []
	expandedPaths.value.clear()
}

// Keyboard shortcut handler
const handleKeyDown = (e) => {
	// Ctrl+Shift+` ((Backquote) — the key value is often '~' when Shift is held) — avoids Chrome’s Cmd+Shift+Option+/ Help shortcut
	const backquote = e.key === '`' || e.key === '~' || e.code === 'Backquote'
	const primaryMod = e.ctrlKey || e.metaKey
	if (primaryMod && e.shiftKey && backquote) {
		e.preventDefault()
		e.stopPropagation()
		toggleConsole()
	}
	// Escape to close
	if (e.key === 'Escape' && isVisible.value) {
		e.preventDefault()
		e.stopPropagation()
		isVisible.value = false
	}
}

// Copy message to clipboard
const copyMessage = async (message) => {
	try {
		const text = typeof message === 'string' ? message : JSON.stringify(message, null, 2)
		await navigator.clipboard.writeText(text)
	} catch (err) {
		console.error('Failed to copy:', err)
	}
}

onMounted(() => {
	interceptConsole()
	window.addEventListener('keydown', handleKeyDown, true)
})

onUnmounted(() => {
	restoreConsole()
	window.removeEventListener('keydown', handleKeyDown, true)
})
</script>

<template>
	<div v-if="isVisible" class="console-panel" @click.self="isVisible = false">
		<div class="console-content" @click.stop>
			<div class="console-header">
				<div class="console-title">
					<span>Console Output</span>
					<span class="message-count">({{ messages.length }} messages)</span>
				</div>
				<div class="console-actions">
					<button @click="clearConsole" class="btn-clear" title="Clear console">
						Clear
					</button>
					<button @click="isVisible = false" class="btn-close" title="Close console">
						<XMarkIcon class="close-icon" width="20" height="20" />
					</button>
				</div>
			</div>
			<div id="console-messages" class="console-messages">
				<div
					v-for="msg in messages"
					:key="msg.id"
					:class="['console-message', `console-message-${msg.type}`]"
				>
					<div class="message-header">
						<span
							:class="['message-type', `message-type-${msg.type}`]"
							:style="{
								color: consoleTypes[msg.type]?.color,
								backgroundColor: consoleTypes[msg.type]?.bgColor,
								borderColor: consoleTypes[msg.type]?.borderColor
							}"
						>
							{{ consoleTypes[msg.type]?.label || msg.type.toUpperCase() }}
						</span>
						<span class="message-timestamp">{{ msg.timestamp }}</span>
						<button
							@click="copyMessage(msg.raw)"
							class="btn-copy"
							title="Copy message"
						>
							Copy
						</button>
					</div>
					<div class="message-content">
						<template v-for="(arg, idx) in msg.args" :key="idx">
							<ConsoleValue
								:value="arg"
								:base-path="`${msg.id}-${idx}`"
								:depth="0"
								@toggle-expanded="toggleExpanded"
								:is-expanded="isExpanded"
							/>
							<span v-if="msg.args.length > 1 && idx < msg.args.length - 1" class="arg-separator"> </span>
						</template>
					</div>
				</div>
				<div v-if="messages.length === 0" class="console-empty">
					No console messages yet. Console output will appear here.
				</div>
			</div>
			<div class="console-footer">
				<div class="console-hint">
					Press <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>&#96;</kbd> to toggle console
				</div>
			</div>
		</div>
	</div>
</template>

<script>
// Recursive component for rendering values with expand/collapse
const ConsoleValue = {
	name: 'ConsoleValue',
	props: {
		value: {
			required: true
		},
		basePath: {
			type: String,
			required: true
		},
		depth: {
			type: Number,
			default: 0
		},
		isExpanded: {
			type: Function,
			required: true
		}
	},
	emits: ['toggle-expanded'],
	setup(props, { emit }) {
		const getValueType = (value) => {
			if (value === null) return 'null'
			if (value === undefined) return 'undefined'
			if (Array.isArray(value)) return 'array'
			if (value instanceof Date) return 'date'
			if (value instanceof Error) return 'error'
			if (typeof value === 'object') return 'object'
			return typeof value
		}

		const formatPrimitive = (value, type) => {
			const colors = {
				string: '#0a0',
				number: '#00a',
				boolean: '#a0a',
				null: '#888',
				undefined: '#888',
				date: '#088',
				error: '#c00',
			}

			const color = colors[type] || '#fff'
			let displayValue = String(value)

			if (type === 'string') {
				displayValue = `"${value}"`
			} else if (type === 'date') {
				displayValue = value.toISOString()
			} else if (type === 'error') {
				displayValue = `${value.name}: ${value.message}`
			}

			return { displayValue, color }
		}

		return () => {
			const value = props.value
			const type = getValueType(value)
			const path = props.basePath
			const depth = props.depth
			const indent = depth * 16

			// Primitive values
			if (type !== 'object' && type !== 'array') {
				const formatted = formatPrimitive(value, type)
				return h('span', {
					class: 'value-primitive',
					style: { color: formatted.color }
				}, formatted.displayValue)
			}

			// Objects and arrays
			const isExp = props.isExpanded(path)
			const keys = type === 'array' ? value.map((_, i) => i) : Object.keys(value)
			const isEmpty = keys.length === 0
			const prefix = type === 'array' ? 'Array' : (value.constructor?.name || 'Object')
			const length = type === 'array' ? value.length : keys.length

			const children = []

			// Expand/collapse button and prefix
			children.push(
				h('span', {
					class: 'expand-toggle',
					onClick: () => emit('toggle-expanded', path),
					style: { marginLeft: `${indent}px`, display: 'inline-flex', alignItems: 'center', gap: '4px', width: '1.25rem', cursor: 'pointer' }
				}, [
					h(isExp ? ChevronDownIcon : ChevronRightIcon, {
						class: 'chevron-icon',
						width: '12',
						height: '12',
						style: { flexShrink: 0 }
					}),
					h('span', { class: 'value-prefix' }, `${prefix}(${length})`)
				])
			)

			// Expanded content
			if (isExp && !isEmpty) {
				keys.forEach((key) => {
					const keyPath = `${path}.${key}`
					const itemValue = value[key]
					const itemType = getValueType(itemValue)

					children.push(
						h('div', {
							class: 'expandable-item',
							style: { marginLeft: `${indent + 16}px`, marginTop: '2px' }
						}, [
							h('span', { class: 'expandable-key' }, `${key}: `),
							itemType === 'object' || itemType === 'array'
								? h(ConsoleValue, {
									value: itemValue,
									basePath: keyPath,
									depth: depth + 1,
									isExpanded: props.isExpanded,
									onToggleExpanded: (p) => emit('toggle-expanded', p)
								})
								: h('span', {
									class: 'value-primitive',
									style: { color: formatPrimitive(itemValue, itemType).color }
								}, formatPrimitive(itemValue, itemType).displayValue)
						])
					)
				})
			} else if (isExp && isEmpty) {
				children.push(
					h('span', {
						class: 'empty-indicator',
						style: { marginLeft: `${indent + 16}px`, display: 'block', marginTop: '2px' }
					}, '(empty)')
				)
			}

			return h('div', { class: 'value-expandable' }, children)
		}
	}
}

export default {
	components: {
		ConsoleValue,
	}
}
</script>

<style scoped lang="scss">
.console-panel {
	position: fixed;
	z-index: 925;
	left: 0;
	top: 0;
	width: 100%;
	height: 100%;
	background: linear-gradient(135deg, rgba(0, 0, 0, 0.6) 0%, rgba(0, 0, 0, 0.4) 100%);
	display: flex;
	justify-content: center;
	align-items: center;
	padding: 2rem;
}

.console-content {
	background: linear-gradient(to bottom, #ffffff 0%, #f8f9fa 100%);
	border-radius: 0.75rem;
	box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.1);
	width: 90%;
	max-width: 75rem;
	height: 85%;
	max-height: 50rem;
	display: flex;
	flex-direction: column;
	overflow: hidden;
	border: 2px solid #e0e0e0;
}

.console-header {
	display: flex;
	justify-content: space-between;
	align-items: center;
	padding: 1rem 1.5rem;
	border-bottom: 2px solid #d0d0d0;
	background: linear-gradient(to bottom, #f0f0f0 0%, #e8e8e8 100%);
	border-radius: 0.75rem 0.75rem 0 0;
}

.console-title {
	font-weight: 700;
	font-size: 1.2rem;
	color: #1a1a1a;
	text-shadow: 0 1px 2px rgba(255, 255, 255, 0.8);

	.message-count {
		font-weight: 500;
		font-size: 0.9rem;
		color: #555;
		margin-left: 0.5rem;
	}
}

.console-actions {
	display: flex;
	gap: 0.5rem;
	align-items: center;
}

.btn-clear,
.btn-close {
	padding: 0.5rem 1rem;
	border: 1px solid #ccc;
	border-radius: 0.4rem;
	background: linear-gradient(to bottom, #ffffff 0%, #f0f0f0 100%);
	color: #333;
	cursor: pointer;
	font-size: 0.875rem;
	font-weight: 500;
	transition: all 0.2s;
	box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);

	&:hover {
		background: linear-gradient(to bottom, #f0f0f0 0%, #e0e0e0 100%);
		border-color: #999;
		transform: translateY(-0.0625rem);
		box-shadow: 0 2px 5px rgba(0, 0, 0, 0.15);
	}

	&:active {
		transform: translateY(0);
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
	}
}

.btn-close {
	padding: 0.5rem;
	display: flex;
	align-items: center;
	justify-content: center;
}

.close-icon {
	color: #333;
}

.console-messages {
	flex: 1;
	overflow-y: auto;
	padding: 1rem;
	background: #1e1e1e;
	font-family: 'Courier New', Consolas, 'Monaco', monospace;
	font-size: 0.875rem;
	line-height: 1.6;
}

.console-message {
	margin-bottom: 0.75rem;
	border-left: 4px solid #dee2e6;
	padding: 0.75rem 1rem;
	background: linear-gradient(to right, rgba(255, 255, 255, 0.05) 0%, transparent 100%);
	border-radius: 0.25rem;
	transition: all 0.2s;

	&:hover {
		background: linear-gradient(to right, rgba(255, 255, 255, 0.1) 0%, transparent 100%);
	}

	&:last-child {
		margin-bottom: 0;
	}
}

.message-header {
	display: flex;
	align-items: center;
	gap: 0.75rem;
	margin-bottom: 0.75rem;
	flex-wrap: wrap;
}

.message-type {
	padding: 0.3rem 0.6rem;
	border-radius: 0.3rem;
	font-size: 0.75rem;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.5px;
	min-width: 3.4375rem;
	text-align: center;
	border: 1px solid;
	box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}

.message-timestamp {
	color: #888;
	font-size: 0.75rem;
	font-family: 'Courier New', Consolas, monospace;
}

.btn-copy {
	padding: 0.25rem 0.6rem;
	border: 1px solid #555;
	border-radius: 0.25rem;
	background: rgba(255, 255, 255, 0.1);
	color: #ccc;
	cursor: pointer;
	font-size: 0.7rem;
	transition: all 0.2s;
	margin-left: auto;

	&:hover {
		background: rgba(255, 255, 255, 0.2);
		border-color: #777;
		color: #fff;
	}
}

.message-content {
	color: #e0e0e0;
	display: flex;
	flex-wrap: wrap;
	align-items: flex-start;
	gap: 0.5rem;
}

.arg-separator {
	margin: 0 0.25rem;
}

.value-primitive {
	font-weight: 500;
}

.value-expandable {
	display: flex;
	flex-direction: column;
	gap: 0.125rem;
	width: 100%;
}

.expand-toggle {
	display: inline-flex;
	align-items: center;
	gap: 0.25rem;
	width: 1.25rem;
	cursor: pointer;
	user-select: none;
	color: #4a9eff;
	transition: color 0.2s;

	&:hover {
		color: #6bb3ff;
	}
}

.chevron-icon {
	flex-shrink: 0;
}

.value-prefix {
	color: #4a9eff;
	font-weight: 600;
}

.expandable-item {
	margin-top: 0.125rem;
	color: #e0e0e0;
}

.expandable-key {
	color: #9cdcfe;
	font-weight: 500;
}

.empty-indicator {
	color: #888;
	font-style: italic;
}

.console-message-log {
	border-left-color: #6c757d;
}

.console-message-info {
	border-left-color: #0dcaf0;
	background: linear-gradient(to right, rgba(13, 202, 240, 0.1) 0%, transparent 100%);
}

.console-message-warn {
	border-left-color: #ffc107;
	background: linear-gradient(to right, rgba(255, 193, 7, 0.1) 0%, transparent 100%);
}

.console-message-error {
	border-left-color: #dc3545;
	background: linear-gradient(to right, rgba(220, 53, 69, 0.15) 0%, transparent 100%);
}

.console-message-debug {
	border-left-color: #6f42c1;
	background: linear-gradient(to right, rgba(111, 66, 193, 0.1) 0%, transparent 100%);
}

.console-message-trace {
	border-left-color: #6c757d;
}

.console-empty {
	text-align: center;
	color: #888;
	padding: 3rem;
	font-style: italic;
	font-size: 1rem;
}

.console-footer {
	padding: 0.75rem 1.5rem;
	border-top: 2px solid #d0d0d0;
	background: linear-gradient(to bottom, #e8e8e8 0%, #f0f0f0 100%);
	border-radius: 0 0 0.75rem 0.75rem;
}

.console-hint {
	font-size: 0.85rem;
	color: #555;
	text-align: center;

	kbd {
		padding: 0.25rem 0.5rem;
		background: linear-gradient(to bottom, #ffffff 0%, #f0f0f0 100%);
		border: 1px solid #ccc;
		border-radius: 0.3rem;
		color: #0e12da;
		font-family: 'Courier New', Consolas, monospace;
		font-size: 0.8rem;
		font-weight: 600;
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.8);
	}
}

// Scrollbar styling with more color
.console-messages::-webkit-scrollbar {
	width: 0.625rem;
}

.console-messages::-webkit-scrollbar-track {
	background: #2a2a2a;
	border-radius: 0.3125rem;
}

.console-messages::-webkit-scrollbar-thumb {
	background: linear-gradient(to bottom, #555 0%, #444 100%);
	border-radius: 0.3125rem;
	border: 1px solid #333;

	&:hover {
		background: linear-gradient(to bottom, #666 0%, #555 100%);
	}
}
</style>
