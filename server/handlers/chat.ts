/**
 * server/handlers/chat.ts — Chat message relay + immediate DB write.
 *
 * When a client sends { t: 'chat', d: { convId, body, replyTo? } }:
 *  1. Server writes the message to Supabase immediately (durable)
 *  2. Broadcasts the confirmed message to all conversation participants
 *
 * Also handles typing indicators (purely ephemeral, never written to DB).
 */

import type { ServerWebSocket } from 'bun'
import type { WSData } from '../index.ts'
import { getSupabase } from '../supabase.ts'
import { getAllUsers } from '../state/world.ts'

/**
 * Handle a chat message from the client.
 * Message: { t: 'chat', d: { convId, body, replyTo?, attachments? } }
 *
 * `attachments` is an array of pre-uploaded files, each:
 *   { kind: 'image'|'file', storagePath, filename, mimeType, sizeBytes, width?, height? }
 * The client uploads to the messaging-attachments bucket first, then posts
 * this metadata. The server inserts message_attachments rows linked to the
 * new message and includes them in the broadcast.
 */
export async function handleChat(ws: ServerWebSocket<WSData>, data: any) {
	const authUserId = ws.data.authUserId
	if (!authUserId) return

	const { convId, body, replyTo, attachments } = data
	const safeAttachments = Array.isArray(attachments) ? attachments : []
	if (!convId) return
	if (!body && safeAttachments.length === 0) return

	try {
		const sb = getSupabase()

		const { data: msg, error } = await sb
			.from('messages')
			.insert({
				conversation_id: convId,
				sender_id: authUserId,
				body: body || '',
				reply_to_id: replyTo || null,
			})
			.select('id, conversation_id, sender_id, body, reply_to_id, created_at')
			.single()

		if (error) {
			console.warn('[chat] insert failed:', error.message)
			sendJson(ws, { t: 'chat_error', d: { convId, error: error.message } })
			return
		}

		let attachmentRows: any[] = []
		if (safeAttachments.length > 0) {
			const insertRows = safeAttachments
				.filter((a: any) => a && a.filename && a.mimeType && (a.storagePath || a.externalUrl))
				.slice(0, 10)
				.map((a: any) => {
					const kind = a.kind === 'gif' ? 'gif' : a.kind === 'image' ? 'image' : 'file'
					return {
						message_id: msg.id,
						conversation_id: convId,
						uploader_id: authUserId,
						kind,
						storage_path: a.storagePath ? String(a.storagePath) : null,
						external_url: a.externalUrl ? String(a.externalUrl).slice(0, 1000) : null,
						filename: String(a.filename).slice(0, 200),
						mime_type: String(a.mimeType).slice(0, 120),
						size_bytes: Math.max(1, Number(a.sizeBytes) || 1),
						width: a.width ? Number(a.width) : null,
						height: a.height ? Number(a.height) : null,
					}
				})

			if (insertRows.length > 0) {
				const { data: rows, error: aErr } = await sb
					.from('message_attachments')
					.insert(insertRows)
					.select('id, message_id, kind, storage_path, external_url, filename, mime_type, size_bytes, width, height, created_at')
				if (aErr) {
					console.warn('[chat] attachment insert failed:', aErr.message)
				} else {
					attachmentRows = rows || []
				}
			}
		}

		const { data: participants } = await sb
			.from('conversation_participants')
			.select('user_id')
			.eq('conversation_id', convId)

		if (!participants) return

		const participantIds = new Set(participants.map((p: any) => p.user_id))
		const confirmed = {
			t: 'chat',
			d: {
				id: msg.id,
				convId: msg.conversation_id,
				senderId: msg.sender_id,
				body: msg.body,
				replyTo: msg.reply_to_id,
				ts: msg.created_at,
				attachments: attachmentRows.map((r: any) => ({
					id: r.id,
					kind: r.kind,
					storagePath: r.storage_path,
					externalUrl: r.external_url,
					filename: r.filename,
					mimeType: r.mime_type,
					sizeBytes: r.size_bytes,
					width: r.width,
					height: r.height,
				})),
			},
		}
		const json = JSON.stringify(confirmed)

		for (const [, state] of getAllUsers()) {
			if (participantIds.has(state.authUserId) && state.ws.readyState === 1) {
				state.ws.send(json)
			}
		}
	} catch (e: any) {
		console.warn('[chat] error:', e.message)
	}
}

/**
 * Handle typing indicator from the client.
 * Message: { t: 'typing', d: { convId, active } }
 * Purely ephemeral — never written to DB.
 */
export function handleTyping(ws: ServerWebSocket<WSData>, data: any) {
	const userId = ws.data.presenceUserId
	const authUserId = ws.data.authUserId
	if (!userId || !authUserId) return

	const { convId, active } = data
	if (!convId) return

	// Relay to all online users (they'll filter by conversation membership client-side)
	// This is simpler than looking up participants for every keystroke
	const msg = JSON.stringify({
		t: 'typing',
		d: { userId, convId, active: !!active },
	})

	for (const [, state] of getAllUsers()) {
		if (state.ws !== ws && state.ws.readyState === 1) {
			state.ws.send(msg)
		}
	}
}

function sendJson(ws: ServerWebSocket<WSData>, msg: any) {
	if (ws.readyState === 1) ws.send(JSON.stringify(msg))
}
