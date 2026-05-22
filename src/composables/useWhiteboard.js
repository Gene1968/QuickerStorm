/**
 * useWhiteboard — Yjs-backed data model for collaborative whiteboards.
 *
 * Provides reactive bindings for sticky notes, freehand strokes, and shapes
 * stored in a shared Y.Doc. Syncs in real-time via useYjsProvider.
 *
 * Yjs Shared Types:
 *   doc.getArray('stickies')  → Y.Array<StickyNote>
 *   doc.getArray('strokes')   → Y.Array<Stroke>
 *   doc.getArray('shapes')    → Y.Array<Shape>
 *   doc.getMap('meta')        → Y.Map { title, persistent, createdBy, ... }
 *
 * Usage:
 *   const { stickies, strokes, shapes, addSticky, addStroke, ... } = useWhiteboard(docId, opts)
 */

import { ref, computed, onUnmounted } from 'vue'
import * as Y from 'yjs'
import { useYjsProvider } from '@/composables/useYjsProvider.js'

// ── Default colors for stickies ─────────────────────────────────────────
export const STICKY_COLORS = [
	'#fef08a', // yellow
	'#bbf7d0', // green
	'#bfdbfe', // blue
	'#fecaca', // red
	'#e9d5ff', // purple
	'#fed7aa', // orange
]

/**
 * @param {string} docId
 * @param {object} opts
 * @param {string} opts.roomId
 * @param {boolean} [opts.persistent=true]
 * @param {string} [opts.title='Whiteboard']
 */
export function useWhiteboard(docId, opts = {}) {
	const {
		doc, awareness, connected, synced, connect, disconnect, broadcastAwareness,
		role, isActualOwner, access, isNew, denied, owner, title: docTitle, members: docMembers, archived, locked, emitPermission,
	} = useYjsProvider(docId, {
		roomId: opts.roomId,
		type: 'whiteboard',
		persistent: opts.persistent ?? true,
		title: opts.title || 'Whiteboard',
	})

	// ── Permission computeds ────────────────────────────────────────────
	const readOnly = computed(() => role.value === 'viewer')
	const isOwner = computed(() => !!isActualOwner.value)

	// ── Yjs shared types ────────────────────────────────────────────────
	const yStickies = doc.getArray('stickies')
	const yStrokes = doc.getArray('strokes')
	const yShapes = doc.getArray('shapes')
	const yMeta = doc.getMap('meta')

	// ── Reactive state (Vue refs synced from Yjs) ───────────────────────
	const stickies = ref([])
	const strokes = ref([])
	const shapes = ref([])

	// ── Observers ─────────────────────────────────────────────────────��─

	function syncStickies() {
		stickies.value = yStickies.toArray().map((item, idx) => ({
			...item,
			_index: idx,
		}))
	}

	function syncStrokes() {
		strokes.value = yStrokes.toArray()
	}

	function syncShapes() {
		shapes.value = yShapes.toArray().map((item, idx) => ({
			...item,
			_index: idx,
		}))
	}

	yStickies.observe(syncStickies)
	yStrokes.observe(syncStrokes)
	yShapes.observe(syncShapes)

	// Initial sync after connect
	syncStickies()
	syncStrokes()
	syncShapes()

	// ── Sticky Note Operations ──────────────────────────────────────────

	function addSticky({ x = 100, y = 100, text = '', color = STICKY_COLORS[0], width = 150, height = 150 } = {}) {
		if (readOnly.value) return null
		const sticky = {
			id: _uid(),
			x, y, width, height,
			text,
			color,
			votes: [],
			createdAt: Date.now(),
		}
		yStickies.push([sticky])
		return sticky.id
	}

	function updateSticky(id, updates) {
		if (readOnly.value) return
		const idx = yStickies.toArray().findIndex(s => s.id === id)
		if (idx === -1) return
		const current = yStickies.get(idx)
		doc.transact(() => {
			yStickies.delete(idx, 1)
			yStickies.insert(idx, [{ ...current, ...updates }])
		})
	}

	function deleteSticky(id) {
		if (readOnly.value) return
		const idx = yStickies.toArray().findIndex(s => s.id === id)
		if (idx === -1) return
		yStickies.delete(idx, 1)
	}

	function voteSticky(id, userId) {
		if (readOnly.value) return
		const idx = yStickies.toArray().findIndex(s => s.id === id)
		if (idx === -1) return
		const current = yStickies.get(idx)
		const votes = current.votes || []
		// Toggle vote
		const hasVoted = votes.includes(userId)
		const newVotes = hasVoted
			? votes.filter(v => v !== userId)
			: [...votes, userId]
		doc.transact(() => {
			yStickies.delete(idx, 1)
			yStickies.insert(idx, [{ ...current, votes: newVotes }])
		})
	}

	// ── Stroke Operations ───────────────────────────────────────────────

	function addStroke({ points, color = '#1e293b', width = 2 }) {
		if (readOnly.value) return null
		const stroke = {
			id: _uid(),
			points,  // [{ x, y }, ...]
			color,
			width,
			createdAt: Date.now(),
		}
		yStrokes.push([stroke])
		return stroke.id
	}

	function deleteStroke(id) {
		if (readOnly.value) return
		const idx = yStrokes.toArray().findIndex(s => s.id === id)
		if (idx === -1) return
		yStrokes.delete(idx, 1)
	}

	function clearStrokes() {
		if (readOnly.value) return
		doc.transact(() => {
			yStrokes.delete(0, yStrokes.length)
		})
	}

	// ── Shape Operations ────────────────────────────────────────────────

	function addShape({ type = 'rect', x = 100, y = 100, width = 120, height = 80, color = '#3b82f6', text = '' }) {
		if (readOnly.value) return null
		const shape = {
			id: _uid(),
			type,  // 'rect', 'circle', 'arrow', 'line'
			x, y, width, height,
			color,
			text,
			createdAt: Date.now(),
		}
		yShapes.push([shape])
		return shape.id
	}

	function updateShape(id, updates) {
		if (readOnly.value) return
		const idx = yShapes.toArray().findIndex(s => s.id === id)
		if (idx === -1) return
		const current = yShapes.get(idx)
		doc.transact(() => {
			yShapes.delete(idx, 1)
			yShapes.insert(idx, [{ ...current, ...updates }])
		})
	}

	function deleteShape(id) {
		if (readOnly.value) return
		const idx = yShapes.toArray().findIndex(s => s.id === id)
		if (idx === -1) return
		yShapes.delete(idx, 1)
	}

	// ── Clear All ───────────────────────────────────────────────────────

	function clearAll() {
		if (readOnly.value) return
		doc.transact(() => {
			yStickies.delete(0, yStickies.length)
			yStrokes.delete(0, yStrokes.length)
			yShapes.delete(0, yShapes.length)
		})
	}

	// ── Awareness (cursor position on whiteboard) ───────────────────────

	function setCursor(x, y, userName, color) {
		awareness.setLocalState({ x, y, userName, color, tool: 'cursor' })
		broadcastAwareness()
	}

	function clearCursor() {
		awareness.setLocalState(null)
		broadcastAwareness()
	}

	// ── Permission management ───────────────────────────────────────────

	function setupBoard(boardTitle, boardAccess, members = []) {
		return emitPermission('setup', { title: boardTitle, access: boardAccess, members })
	}

	function updatePermissions(boardAccess, members = [], boardTitle = null) {
		const payload = { access: boardAccess, members }
		if (boardTitle) payload.title = boardTitle
		return emitPermission('update', payload)
	}

	function archiveBoard() {
		return emitPermission('archive', { locked: true })
	}

	function setLocked(next) {
		return emitPermission('update', { locked: !!next })
	}

	function createNewBoard(boardTitle, boardAccess, members = []) {
		return emitPermission('new-board', {
			title: boardTitle,
			access: boardAccess,
			members,
			roomId: opts.roomId,
		})
	}

	function listHistory() {
		return emitPermission('list-history', { roomId: opts.roomId, type: 'whiteboard' })
	}

	// ── Cleanup ─────────────────────────────────────────────────────────

	onUnmounted(() => {
		yStickies.unobserve(syncStickies)
		yStrokes.unobserve(syncStrokes)
		yShapes.unobserve(syncShapes)
	})

	return {
		// State
		doc,
		stickies,
		strokes,
		shapes,
		connected,
		synced,
		awareness,

		// Permission state
		role,
		access,
		isNew,
		denied,
		owner,
		docTitle,
		docMembers,
		archived,
		locked,
		readOnly,
		isOwner,

		// Lifecycle
		connect,
		disconnect,

		// Stickies
		addSticky,
		updateSticky,
		deleteSticky,
		voteSticky,

		// Strokes
		addStroke,
		deleteStroke,
		clearStrokes,

		// Shapes
		addShape,
		updateShape,
		deleteShape,

		// Utils
		clearAll,
		setCursor,
		clearCursor,

		// Permissions
		setupBoard,
		updatePermissions,
		archiveBoard,
		setLocked,
		createNewBoard,
		listHistory,
	}
}

// ── Helpers ─────────────────────────────────────────────────────────────

function _uid() {
	return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2, 10)
}
