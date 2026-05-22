/**
 * useCollabDoc — Yjs-backed data model for collaborative markdown documents.
 *
 * Wraps useYjsProvider with type='doc' and exposes a Y.Text-backed body plus
 * a Y.Map of meta. Supports document templates (standup, retro, decision).
 *
 * Yjs Shared Types:
 *   doc.getText('body')   → Y.Text (markdown content)
 *   doc.getMap('meta')    → Y.Map  ({ template, ... })
 *
 * Usage:
 *   const { text, setText, applyTemplate, ... } = useCollabDoc(docId, opts)
 */

import { ref, computed, onUnmounted } from 'vue'
import { useYjsProvider } from '@/composables/useYjsProvider.js'

// ── Document templates ──────────────────────────────────────────────────
export const DOC_TEMPLATES = {
	blank: {
		label: 'Blank',
		body: '',
	},
	standup: {
		label: 'Daily Standup',
		body: `# Daily Standup — ${todayLabel()}

## Yesterday
-

## Today
-

## Blockers
-
`,
	},
	retro: {
		label: 'Retro',
		body: `# Retro — ${todayLabel()}

## What went well 🟢
-

## What didn't 🔴
-

## Action items ▶
- [ ]
`,
	},
	decision: {
		label: 'Decision Log',
		body: `# Decision Log — ${todayLabel()}

**Status:** Proposed
**Owner:**

## Context


## Options considered


## Decision


## Consequences

`,
	},
	notes: {
		label: 'Meeting Notes',
		body: `# Meeting Notes — ${todayLabel()}

**Attendees:**

## Agenda
1.

## Discussion


## Action Items
- [ ]
`,
	},
}

function todayLabel() {
	const d = new Date()
	return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * @param {string} docId
 * @param {object} opts
 * @param {string} opts.roomId
 * @param {boolean} [opts.persistent=true]
 * @param {string} [opts.title='Document']
 */
export function useCollabDoc(docId, opts = {}) {
	const {
		doc, awareness, connected, synced, connect, disconnect, broadcastAwareness,
		role, isActualOwner, access, isNew, denied, owner, title: docTitle, members: docMembers, archived, locked, emitPermission,
	} = useYjsProvider(docId, {
		roomId: opts.roomId,
		type: 'doc',
		persistent: opts.persistent ?? true,
		title: opts.title || 'Document',
	})

	// ── Permission computeds ────────────────────────────────────────────
	const readOnly = computed(() => role.value === 'viewer')
	const isOwner = computed(() => !!isActualOwner.value)

	// ── Yjs shared types ────────────────────────────────────────────────
	const yBody = doc.getText('body')
	const yMeta = doc.getMap('meta')

	// ── Reactive text mirror ────────────────────────────────────────────
	const text = ref(yBody.toString())

	function syncText() {
		const next = yBody.toString()
		if (next !== text.value) text.value = next
	}
	yBody.observe(syncText)

	// ── Y.Text editing (diff-based to preserve concurrent edits) ────────

	/**
	 * Replace the document text using a minimal diff.
	 * Computes common prefix/suffix and only deletes/inserts the changed range,
	 * which preserves remote edits made between local keystrokes.
	 */
	function setText(next) {
		if (readOnly.value) return
		const cur = yBody.toString()
		if (cur === next) return

		const minLen = Math.min(cur.length, next.length)
		let prefix = 0
		while (prefix < minLen && cur.charCodeAt(prefix) === next.charCodeAt(prefix)) prefix++

		let suffix = 0
		while (
			suffix < minLen - prefix &&
			cur.charCodeAt(cur.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)
		) suffix++

		const deleteLen = cur.length - prefix - suffix
		const insertStr = next.slice(prefix, next.length - suffix)

		doc.transact(() => {
			if (deleteLen > 0) yBody.delete(prefix, deleteLen)
			if (insertStr.length > 0) yBody.insert(prefix, insertStr)
		})
	}

	/**
	 * Apply a template body — only if the document is currently empty.
	 * Stores the template name in yMeta.
	 */
	function applyTemplate(templateKey) {
		if (readOnly.value) return false
		const tpl = DOC_TEMPLATES[templateKey]
		if (!tpl) return false
		if (yBody.length > 0) return false  // never overwrite existing content
		doc.transact(() => {
			yBody.insert(0, tpl.body)
			yMeta.set('template', templateKey)
		})
		return true
	}

	const template = computed(() => yMeta.get('template') || null)

	// ── Awareness (cursor position by character offset) ─────────────────

	function setCursor(offset, userName, color) {
		awareness.setLocalState({ offset, userName, color, kind: 'doc-cursor' })
		broadcastAwareness()
	}

	function clearCursor() {
		awareness.setLocalState(null)
		broadcastAwareness()
	}

	// ── Permission management (passthrough wrapped) ─────────────────────

	function setupBoard(t, a, members = []) {
		return emitPermission('setup', { title: t, access: a, members })
	}

	function updatePermissions(a, members = [], t = null) {
		const payload = { access: a, members }
		if (t) payload.title = t
		return emitPermission('update', payload)
	}

	function archiveBoard() { return emitPermission('archive', { locked: true }) }
	function setLocked(next) { return emitPermission('update', { locked: !!next }) }

	function createNewBoard(t, a, members = []) {
		return emitPermission('new-board', {
			title: t, access: a, members, roomId: opts.roomId,
		})
	}

	function listHistory() { return emitPermission('list-history', { roomId: opts.roomId, type: 'doc' }) }

	// ── Cleanup ─────────────────────────────────────────────────────────

	onUnmounted(() => {
		yBody.unobserve(syncText)
	})

	return {
		// State
		doc,
		text,
		template,
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

		// Editing
		setText,
		applyTemplate,
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
