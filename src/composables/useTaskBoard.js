/**
 * useTaskBoard — Yjs-backed kanban data model.
 *
 * Yjs Shared Types:
 *   doc.getArray('columns') → Y.Array<Column>  [{ id, title }]
 *   doc.getArray('cards')   → Y.Array<Card>    [{ id, columnId, title, body, assignee, order }]
 *   doc.getMap('meta')      → Y.Map { template, ... }
 *
 * Cards within a column are sorted by their `order` (float). To insert between
 * two cards we take the average; we never renormalize because the precision
 * of double-precision floats is enough for thousands of inserts.
 */

import { ref, computed, onUnmounted } from 'vue'
import { useYjsProvider } from '@/composables/useYjsProvider.js'

export const DEFAULT_COLUMNS = ['To Do', 'In Progress', 'Done']

export function useTaskBoard(docId, opts = {}) {
	const {
		doc, awareness, connected, synced, connect, disconnect, broadcastAwareness,
		role, isActualOwner, access, isNew, denied, owner, title: docTitle, members: docMembers, archived, locked, emitPermission,
	} = useYjsProvider(docId, {
		roomId: opts.roomId,
		type: 'taskboard',
		persistent: opts.persistent ?? true,
		title: opts.title || 'Task Board',
	})

	const readOnly = computed(() => role.value === 'viewer')
	// Use the membership-based actual-owner flag so locked archived boards
	// still let the actual owner reach the settings panel to unlock them.
	const isOwner = computed(() => !!isActualOwner.value)

	const yColumns = doc.getArray('columns')
	const yCards = doc.getArray('cards')

	const columns = ref([])
	const cards = ref([])

	function syncColumns() { columns.value = yColumns.toArray().slice() }
	function syncCards() { cards.value = yCards.toArray().slice() }

	yColumns.observe(syncColumns)
	yCards.observe(syncCards)
	syncColumns()
	syncCards()

	// ── Column ops ──────────────────────────────────────────────────────

	function addColumn(title = 'New Column') {
		if (readOnly.value) return null
		const col = { id: _uid(), title }
		doc.transact(() => { yColumns.push([col]) })
		return col.id
	}

	function renameColumn(id, title) {
		if (readOnly.value) return
		const idx = yColumns.toArray().findIndex(c => c.id === id)
		if (idx === -1) return
		const cur = yColumns.get(idx)
		doc.transact(() => {
			yColumns.delete(idx, 1)
			yColumns.insert(idx, [{ ...cur, title }])
		})
	}

	function deleteColumn(id) {
		if (readOnly.value) return
		const idx = yColumns.toArray().findIndex(c => c.id === id)
		if (idx === -1) return
		doc.transact(() => {
			yColumns.delete(idx, 1)
			// Cascade-delete cards in this column (iterate from end to keep indices stable)
			const arr = yCards.toArray()
			for (let i = arr.length - 1; i >= 0; i--) {
				if (arr[i].columnId === id) yCards.delete(i, 1)
			}
		})
	}

	/** Ensure board has the default columns (idempotent — only seeds when empty). */
	function seedDefaultColumns() {
		if (readOnly.value) return
		if (yColumns.length > 0) return
		doc.transact(() => {
			for (const t of DEFAULT_COLUMNS) yColumns.push([{ id: _uid(), title: t }])
		})
	}

	// ── Card ops ────────────────────────────────────────────────────────

	function addCard({ columnId, title = 'New task', body = '', assignee = null }) {
		if (readOnly.value) return null
		if (!columnId) return null
		// Place at end of column
		const colCards = yCards.toArray().filter(c => c.columnId === columnId)
		const lastOrder = colCards.length ? Math.max(...colCards.map(c => c.order || 0)) : 0
		const card = {
			id: _uid(),
			columnId,
			title,
			body,
			assignee,
			order: lastOrder + 1024,
			createdAt: Date.now(),
		}
		doc.transact(() => { yCards.push([card]) })
		return card.id
	}

	function updateCard(id, updates) {
		if (readOnly.value) return
		const idx = yCards.toArray().findIndex(c => c.id === id)
		if (idx === -1) return
		const cur = yCards.get(idx)
		doc.transact(() => {
			yCards.delete(idx, 1)
			yCards.insert(idx, [{ ...cur, ...updates }])
		})
	}

	function deleteCard(id) {
		if (readOnly.value) return
		const idx = yCards.toArray().findIndex(c => c.id === id)
		if (idx === -1) return
		yCards.delete(idx, 1)
	}

	/**
	 * Move a card to a new column at a target position (0-based index within
	 * the destination column's currently sorted card list).
	 */
	function moveCard(id, targetColumnId, targetIdx) {
		if (readOnly.value) return
		const arr = yCards.toArray()
		const idx = arr.findIndex(c => c.id === id)
		if (idx === -1) return

		const colCards = arr
			.filter(c => c.columnId === targetColumnId && c.id !== id)
			.sort((a, b) => (a.order || 0) - (b.order || 0))

		let newOrder
		if (colCards.length === 0) {
			newOrder = 1024
		} else if (targetIdx <= 0) {
			newOrder = (colCards[0].order || 0) - 512
		} else if (targetIdx >= colCards.length) {
			newOrder = (colCards[colCards.length - 1].order || 0) + 512
		} else {
			const before = colCards[targetIdx - 1].order || 0
			const after = colCards[targetIdx].order || 0
			newOrder = (before + after) / 2
		}

		const cur = yCards.get(idx)
		doc.transact(() => {
			yCards.delete(idx, 1)
			yCards.insert(idx, [{ ...cur, columnId: targetColumnId, order: newOrder }])
		})
	}

	/** Cards grouped by column (sorted by order). */
	const cardsByColumn = computed(() => {
		const grouped = new Map()
		for (const col of columns.value) grouped.set(col.id, [])
		for (const card of cards.value) {
			if (!grouped.has(card.columnId)) grouped.set(card.columnId, [])
			grouped.get(card.columnId).push(card)
		}
		for (const list of grouped.values()) {
			list.sort((a, b) => (a.order || 0) - (b.order || 0))
		}
		return grouped
	})

	// ── Awareness (cursor on a card) ────────────────────────────────────
	function setFocus(cardId, userName, color) {
		awareness.setLocalState({ cardId, userName, color, kind: 'tb-focus' })
		broadcastAwareness()
	}
	function clearFocus() {
		awareness.setLocalState(null)
		broadcastAwareness()
	}

	// ── Permissions ─────────────────────────────────────────────────────
	function setupBoard(t, a, members = []) { return emitPermission('setup', { title: t, access: a, members }) }
	function updatePermissions(a, members = [], t = null) {
		const payload = { access: a, members }
		if (t) payload.title = t
		return emitPermission('update', payload)
	}
	function archiveBoard() { return emitPermission('archive', { locked: true }) }
	/** Save the board to history but keep it editable (taskboard-specific UX). */
	function saveBoard() { return emitPermission('archive', { locked: false }) }
	/** Owner-only: toggle the lock state of an archived board. */
	function setLocked(next) { return emitPermission('update', { locked: !!next }) }
	function listHistory() { return emitPermission('list-history', { roomId: opts.roomId, type: 'taskboard' }) }

	onUnmounted(() => {
		yColumns.unobserve(syncColumns)
		yCards.unobserve(syncCards)
	})

	return {
		// State
		doc,
		columns,
		cards,
		cardsByColumn,
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

		// Columns
		addColumn,
		renameColumn,
		deleteColumn,
		seedDefaultColumns,

		// Cards
		addCard,
		updateCard,
		deleteCard,
		moveCard,

		// Awareness
		setFocus,
		clearFocus,

		// Permissions
		setupBoard,
		updatePermissions,
		archiveBoard,
		saveBoard,
		setLocked,
		listHistory,
	}
}

function _uid() {
	return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2, 10)
}
