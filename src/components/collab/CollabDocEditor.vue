<script setup>
/**
 * CollabDocEditor — Markdown editor with split pane (edit / preview).
 *
 * Two-way binds a Y.Text-backed string to a textarea. Renders a live
 * markdown preview using an inline renderer (no external deps).
 *
 * Cursor handling:
 *  - When remote text updates arrive while focused, we adjust the cursor by
 *    the net length change at/before the cursor offset so the user keeps place.
 *  - We broadcast the local cursor offset (throttled) via the awareness object
 *    and render remote cursors as colored carets + name pills using a hidden
 *    text-mirror element to project a character offset → pixel position.
 */
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'

const props = defineProps({
	text:           { type: String, default: '' },
	readOnly:       { type: Boolean, default: false },
	mode:           { type: String, default: 'split' }, // 'edit' | 'preview' | 'split'
	awareness:      { type: Object, default: null },     // SimpleAwareness
	localUserName:  { type: String, default: '' },
	localUserColor: { type: String, default: '#3b82f6' },
})

const emit = defineEmits(['update:text', 'cursor', 'cursor-leave'])

const taRef = ref(null)
const mirrorRef = ref(null)
const editPaneRef = ref(null)
const localValue = ref(props.text)
const isFocused = ref(false)
const scrollTop = ref(0)

// ── Local input → emit ──────────────────────────────────────────────────
function onInput(e) {
	const next = e.target.value
	localValue.value = next
	if (!props.readOnly) emit('update:text', next)
	broadcastLocalCursor(e.target.selectionStart)
}

function onSelect(e) { broadcastLocalCursor(e.target.selectionStart) }

function onFocus(e) {
	isFocused.value = true
	broadcastLocalCursor(e.target.selectionStart)
}
function onBlur() {
	isFocused.value = false
	emit('cursor-leave')
}

function onScroll(e) {
	scrollTop.value = e.target.scrollTop
}

// ── Throttled cursor broadcast (leading-edge: fires immediately, then
//    suppresses for 60 ms; flushes any pending offset at the trailing edge). ──
let cursorBroadcastTimer = null
let pendingOffset = null
function broadcastLocalCursor(offset) {
	if (props.readOnly) return
	if (cursorBroadcastTimer) {
		pendingOffset = offset
		return
	}
	emit('cursor', offset)
	pendingOffset = null
	cursorBroadcastTimer = setTimeout(() => {
		cursorBroadcastTimer = null
		if (pendingOffset !== null) {
			emit('cursor', pendingOffset)
			pendingOffset = null
		}
	}, 60)
}

// ── Sync remote text → textarea (preserving cursor) ─────────────────────
watch(() => props.text, (next, prev) => {
	if (next === localValue.value) return

	if (!isFocused.value || !taRef.value) {
		localValue.value = next
		return
	}

	const ta = taRef.value
	const cursor = ta.selectionStart
	const minLen = Math.min(prev.length, next.length)
	let prefix = 0
	while (prefix < minLen && prev.charCodeAt(prefix) === next.charCodeAt(prefix)) prefix++

	const lengthDelta = next.length - prev.length
	let nextCursor = cursor
	if (cursor > prefix) nextCursor = cursor + lengthDelta
	if (nextCursor < 0) nextCursor = 0
	if (nextCursor > next.length) nextCursor = next.length

	localValue.value = next
	nextTick(() => {
		try { ta.setSelectionRange(nextCursor, nextCursor) } catch { /* ignore */ }
	})
})

onMounted(() => {
	if (props.text !== localValue.value) localValue.value = props.text
	if (props.awareness) {
		_unsubAwareness = props.awareness.onChange(scheduleRecompute)
		nextTick(scheduleRecompute)
	}
	window.addEventListener('resize', scheduleRecompute)
})

onUnmounted(() => {
	if (_unsubAwareness) _unsubAwareness()
	window.removeEventListener('resize', scheduleRecompute)
	if (cursorBroadcastTimer) clearTimeout(cursorBroadcastTimer)
	if (recomputeRaf) cancelAnimationFrame(recomputeRaf)
})

// Recompute remote-cursor positions when text changes (after DOM update)
watch(localValue, () => nextTick(scheduleRecompute))

// ── Remote cursor rendering ─────────────────────────────────────────────
const remoteCursors = ref([])
let _unsubAwareness = null
let recomputeRaf = null

function scheduleRecompute() {
	if (recomputeRaf) return
	recomputeRaf = requestAnimationFrame(() => {
		recomputeRaf = null
		recomputeCursors()
	})
}

function recomputeCursors() {
	if (!props.awareness || !mirrorRef.value) {
		remoteCursors.value = []
		return
	}
	const states = props.awareness.getStates()
	const localId = props.awareness.clientId
	const out = []
	for (const [clientId, state] of states) {
		if (clientId === localId) continue
		if (!state || state.kind !== 'doc-cursor') continue
		if (typeof state.offset !== 'number') continue

		const pos = getCursorPixelPos(state.offset)
		if (!pos) continue
		out.push({
			clientId,
			x: pos.x,
			y: pos.y,
			height: pos.height,
			color: state.color || '#3b82f6',
			userName: state.userName || 'User',
		})
	}
	remoteCursors.value = out
}

/** Project a character offset to (x, y) within the mirror element. */
function getCursorPixelPos(offset) {
	const mirror = mirrorRef.value
	if (!mirror) return null
	const textNode = mirror.firstChild
	if (!textNode) {
		// Empty doc — return top-left of mirror
		return { x: 0, y: 0, height: parseFloat(getComputedStyle(mirror).lineHeight) || 18 }
	}
	if (textNode.nodeType !== Node.TEXT_NODE) return null

	const safeOffset = Math.max(0, Math.min(offset, textNode.data.length))
	let range
	try {
		range = document.createRange()
		range.setStart(textNode, safeOffset)
		range.setEnd(textNode, safeOffset)
	} catch {
		return null
	}

	const rect = range.getBoundingClientRect()
	const containerRect = mirror.getBoundingClientRect()
	let x = rect.left - containerRect.left
	let y = rect.top - containerRect.top
	let height = rect.height
	// At the end of a line a collapsed range can return zero height — fall back
	// to the line-height from computed style.
	if (!height) height = parseFloat(getComputedStyle(mirror).lineHeight) || 18
	// At end of doc, range may report (0, 0) — check by re-running with offset-1
	if (x === 0 && y === 0 && safeOffset > 0) {
		try {
			const r2 = document.createRange()
			r2.setStart(textNode, safeOffset - 1)
			r2.setEnd(textNode, safeOffset)
			const rect2 = r2.getBoundingClientRect()
			x = rect2.right - containerRect.left
			y = rect2.top - containerRect.top
		} catch { /* ignore */ }
	}
	return { x, y, height }
}

// ── Markdown rendering (inline, dependency-free) ────────────────────────
const previewHtml = computed(() => renderMarkdown(localValue.value))

function renderMarkdown(src) {
	if (!src) return '<p class="md-empty">Nothing here yet — start writing on the left.</p>'
	let s = src.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
	const codeBlocks = []
	s = s.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_m, lang, body) => {
		codeBlocks.push({ lang, body })
		return `@@CODEBLOCK_${codeBlocks.length - 1}@@`
	})
	const lines = s.split('\n')
	const out = []
	let inList = null
	let inQuote = false
	let para = []
	function flushPara() { if (para.length) { out.push(`<p>${inlineMd(para.join(' '))}</p>`); para = [] } }
	function closeList() { if (inList) { out.push(`</${inList}>`); inList = null } }
	function closeQuote() { if (inQuote) { out.push('</blockquote>'); inQuote = false } }
	for (const raw of lines) {
		const line = raw
		if (!line.trim()) { flushPara(); closeList(); closeQuote(); continue }
		if (/^---+\s*$/.test(line)) { flushPara(); closeList(); closeQuote(); out.push('<hr/>'); continue }
		const h = line.match(/^(#{1,6})\s+(.*)$/)
		if (h) { flushPara(); closeList(); closeQuote(); out.push(`<h${h[1].length}>${inlineMd(h[2])}</h${h[1].length}>`); continue }
		if (line.startsWith('&gt; ') || line === '&gt;') {
			flushPara(); closeList()
			if (!inQuote) { out.push('<blockquote>'); inQuote = true }
			out.push(`<p>${inlineMd(line.replace(/^&gt;\s?/, ''))}</p>`)
			continue
		} else closeQuote()
		const cb = line.match(/^[-*]\s+\[([ xX])\]\s+(.*)$/)
		if (cb) {
			flushPara()
			if (inList !== 'ul') { closeList(); out.push('<ul class="md-checklist">'); inList = 'ul' }
			const checked = cb[1].toLowerCase() === 'x'
			out.push(`<li class="md-cb-item">${checked ? '<span class="md-cb checked">☑</span>' : '<span class="md-cb">☐</span>'} ${inlineMd(cb[2])}</li>`)
			continue
		}
		const ul = line.match(/^[-*]\s+(.*)$/)
		if (ul) {
			flushPara()
			if (inList !== 'ul') { closeList(); out.push('<ul>'); inList = 'ul' }
			out.push(`<li>${inlineMd(ul[1])}</li>`); continue
		}
		const ol = line.match(/^\d+\.\s+(.*)$/)
		if (ol) {
			flushPara()
			if (inList !== 'ol') { closeList(); out.push('<ol>'); inList = 'ol' }
			out.push(`<li>${inlineMd(ol[1])}</li>`); continue
		}
		closeList()
		para.push(line)
	}
	flushPara(); closeList(); closeQuote()
	let html = out.join('\n')
	html = html.replace(/@@CODEBLOCK_(\d+)@@/g, (_m, idx) => {
		const cb = codeBlocks[Number(idx)]
		const langClass = cb.lang ? ` class="lang-${cb.lang}"` : ''
		return `<pre><code${langClass}>${cb.body}</code></pre>`
	})
	return html
}

function inlineMd(s) {
	return s
		.replace(/`([^`]+)`/g, '<code>$1</code>')
		.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
		.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
		.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g,
			'<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
}
</script>

<template>
	<div class="doc-editor" :class="`mode-${mode}`">
		<div v-if="mode !== 'preview'" ref="editPaneRef" class="doc-pane edit-pane">
			<div class="edit-pane-inner">
				<textarea
					ref="taRef"
					class="doc-textarea"
					:value="localValue"
					:readonly="readOnly"
					:placeholder="readOnly ? '' : 'Start writing in markdown...'"
					spellcheck="true"
					@input="onInput"
					@select="onSelect"
					@keyup="onSelect"
					@click="onSelect"
					@focus="onFocus"
					@blur="onBlur"
					@scroll="onScroll"
				></textarea>

				<!-- Hidden text mirror used to project character offsets → pixel positions -->
				<div ref="mirrorRef" class="text-mirror" aria-hidden="true">{{ localValue }}</div>

				<!-- Remote-cursor overlay (carets + name pills), translated by current scroll -->
				<div class="cursor-layer" :style="{ transform: `translate(0, ${-scrollTop}px)` }">
					<div
						v-for="c in remoteCursors"
						:key="c.clientId"
						class="remote-cursor"
						:style="{ left: c.x + 'px', top: c.y + 'px', height: c.height + 'px', color: c.color }"
					>
						<div class="rc-name" :style="{ background: c.color }">{{ c.userName }}</div>
						<div class="rc-caret" :style="{ background: c.color }"></div>
					</div>
				</div>
			</div>
		</div>
		<div v-if="mode !== 'edit'" class="doc-pane preview-pane">
			<div class="doc-preview" v-html="previewHtml"></div>
		</div>
	</div>
</template>

<style scoped>
.doc-editor {
	flex: 1;
	display: flex;
	overflow: hidden;
	background: #fff;
}

.doc-editor.mode-split .doc-pane { flex: 1; }
.doc-editor.mode-edit .edit-pane { flex: 1; }
.doc-editor.mode-preview .preview-pane { flex: 1; }

.doc-pane {
	overflow: hidden;
	display: flex;
	flex-direction: column;
}

.edit-pane {
	border-right: 1px solid #e2e8f0;
	background: #fafafa;
}

/* Container for textarea + mirror + cursor layer (all share same coord system). */
.edit-pane-inner {
	position: relative;
	flex: 1;
	display: flex;
	overflow: hidden;
}

/* Shared text styling (textarea + mirror MUST match exactly so the mirror's
   character positions equal the textarea's rendered positions). */
.doc-textarea,
.text-mirror {
	font-family: 'SFMono-Regular', Menlo, Consolas, monospace;
	font-size: 14px;
	line-height: 1.55;
	letter-spacing: 0;
	tab-size: 2;
	padding: 20px 24px;
	box-sizing: border-box;
	white-space: pre-wrap;
	word-wrap: break-word;
}

.doc-textarea {
	flex: 1;
	width: 100%;
	border: none;
	outline: none;
	resize: none;
	color: #1e293b;
	background: transparent;
	position: relative;
	z-index: 2;
}

.text-mirror {
	position: absolute;
	top: 0; left: 0; right: 0;
	min-height: 100%;
	visibility: hidden;
	pointer-events: none;
	color: transparent;
	overflow: visible;
}

.cursor-layer {
	position: absolute;
	top: 0; left: 0; right: 0; bottom: 0;
	pointer-events: none;
	overflow: hidden;
	z-index: 3;
}

.remote-cursor {
	position: absolute;
	transition: left 0.08s ease-out, top 0.08s ease-out;
}

.rc-caret {
	position: absolute;
	top: 0;
	left: 0;
	width: 2px;
	height: 100%;
	background: currentColor;
	border-radius: 1px;
}

.rc-name {
	position: absolute;
	top: -16px;
	left: -1px;
	font-size: 10px;
	font-weight: 600;
	padding: 1px 5px;
	border-radius: 3px;
	color: #fff;
	white-space: nowrap;
	line-height: 1.4;
	background: currentColor;
	text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}

.preview-pane {
	background: #fff;
}

.doc-preview {
	flex: 1;
	padding: 20px 28px;
	overflow-y: auto;
	font-size: 15px;
	line-height: 1.6;
	color: #1e293b;
}

.doc-preview :deep(h1) { font-size: 26px; font-weight: 700; margin: 0 0 12px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; }
.doc-preview :deep(h2) { font-size: 20px; font-weight: 700; margin: 18px 0 10px; }
.doc-preview :deep(h3) { font-size: 17px; font-weight: 600; margin: 14px 0 8px; }
.doc-preview :deep(h4) { font-size: 15px; font-weight: 600; margin: 12px 0 6px; }
.doc-preview :deep(p) { margin: 0 0 10px; }
.doc-preview :deep(ul), .doc-preview :deep(ol) { margin: 0 0 10px; padding-left: 24px; }
.doc-preview :deep(li) { margin: 2px 0; }
.doc-preview :deep(blockquote) {
	margin: 0 0 10px;
	padding: 4px 12px;
	border-left: 3px solid #cbd5e1;
	background: #f8fafc;
	color: #475569;
}
.doc-preview :deep(code) {
	font-family: 'SFMono-Regular', Menlo, Consolas, monospace;
	font-size: 13px;
	padding: 1px 5px;
	background: #f1f5f9;
	border-radius: 3px;
	color: #0f172a;
}
.doc-preview :deep(pre) {
	background: #0f172a;
	color: #e2e8f0;
	padding: 12px 16px;
	border-radius: 6px;
	overflow-x: auto;
	margin: 0 0 10px;
}
.doc-preview :deep(pre code) { background: transparent; color: inherit; padding: 0; font-size: 13px; }
.doc-preview :deep(a) { color: #2563eb; text-decoration: underline; }
.doc-preview :deep(hr) { border: none; border-top: 1px solid #e2e8f0; margin: 16px 0; }
.doc-preview :deep(.md-empty) { color: #94a3b8; font-style: italic; }
.doc-preview :deep(.md-checklist) { list-style: none; padding-left: 4px; }
.doc-preview :deep(.md-cb-item) { display: flex; align-items: flex-start; gap: 6px; }
.doc-preview :deep(.md-cb) { color: #94a3b8; font-size: 16px; line-height: 1; padding-top: 1px; }
.doc-preview :deep(.md-cb.checked) { color: #16a34a; }
</style>
