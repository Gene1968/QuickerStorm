// Xfer subsystem tests — RequestXfer/ConfirmXferPacket/AbortXfer encoders + the keyed
// reassembly state machine (3-chunk reassembly incl. EOF bit + packet-0 length prefix).
// References: OpenSim XferModule.cs:408 SendPacket (1KB chunks, EOF bit 0x80000000),
// LLClientView.cs:2843 SendXferPacket (packet 0 prepends U32 total length),
// FS llxfer_file.cpp:161 startDownload / llxfermanager.cpp:526 processReceiveData.
import { describe, it, expect } from 'bun:test'
import {
	encodeRequestXfer, encodeConfirmXferPacket, encodeAbortXfer,
	mapSendXferPacket, nextXferId, startXfer, ingestXferChunk, abortXfer,
	clearXferScope, XFER_EOF_BIT,
} from '../lib/xfer'
import { encode, decode } from '../lib/protocol/codec.ts'

const ZERO = '00000000-0000-0000-0000-000000000000'

// Build a sim-side SendXferPacket (High 18) the way OpenSim does (LLClientView.cs:2843):
// packet 0 payload = U32LE(totalLen) + chunk; EOF = high bit on the Packet number.
function simChunk(xferId: bigint, packet: number, data: Buffer, opts: { eof?: boolean; totalLen?: number } = {}): Buffer {
	const payload = packet === 0 && opts.totalLen !== undefined
		? Buffer.concat([(() => { const b = Buffer.alloc(4); b.writeUInt32LE(opts.totalLen, 0); return b })(), data])
		: data
	return encode('SendXferPacket', {
		XferID:     { ID: xferId, Packet: (packet | (opts.eof ? XFER_EOF_BIT : 0)) >>> 0 },
		DataPacket: { Data: payload },
	}, { seq: 1, reliable: false })
}

const chunkOf = (buf: Buffer) => {
	const c = mapSendXferPacket(decode(buf).blocks)
	expect(c).not.toBeNull()
	return c!
}

describe('encodeRequestXfer (Low 156, message_template.msg:3541)', () => {
	it('round-trips FS llxfer_file.cpp:171-179 field values', () => {
		const id = 0x1122334455667788n
		const msg = decode(encodeRequestXfer({ seq: 3, xferId: id, filename: 'inventory_abc.tmp' }))
		expect(msg.name).toBe('RequestXfer')
		const x = msg.blocks.XferID[0]
		expect(x.ID).toBe(id)
		expect((x.Filename as Buffer).toString('utf8')).toBe('inventory_abc.tmp\0')
		expect(x.FilePath).toBe(0)             // OpenSim ignores it (LLClientView.cs:10037)
		expect(x.DeleteOnCompletion).toBe(true)
		expect(x.UseBigPackets).toBe(false)
		expect(x.VFileID).toBe(ZERO)
		expect(x.VFileType).toBe(-1)           // file xfer marker (llxfer_file.cpp:179)
	})
})

describe('encodeConfirmXferPacket (High 19) / encodeAbortXfer (Low 157)', () => {
	it('confirm carries the masked packet number', () => {
		const msg = decode(encodeConfirmXferPacket({ seq: 4, xferId: 42n, packet: 2 }))
		expect(msg.name).toBe('ConfirmXferPacket')
		expect(msg.blocks.XferID[0].ID).toBe(42n)
		expect(msg.blocks.XferID[0].Packet).toBe(2)
	})
	it('abort defaults Result to -1 (FS abortRequestById, llviewerobject.cpp:3444)', () => {
		const msg = decode(encodeAbortXfer({ seq: 5, xferId: 42n }))
		expect(msg.name).toBe('AbortXfer')
		expect(msg.blocks.XferID[0].ID).toBe(42n)
		expect(msg.blocks.XferID[0].Result).toBe(-1)
	})
})

describe('mapSendXferPacket — EOF bit decode', () => {
	it('strips the 0x80000000 EOF bit into eof=true (XferModule.cs:417)', () => {
		const c = chunkOf(simChunk(9n, 3, Buffer.from('tail'), { eof: true }))
		expect(c.xferId).toBe(9n)
		expect(c.packet).toBe(3)
		expect(c.eof).toBe(true)
		expect(c.data.toString('utf8')).toBe('tail')
	})
})

describe('3-chunk reassembly (packet-0 length prefix + EOF)', () => {
	it('reassembles 2500 bytes across 1024/1024/452 chunks', () => {
		const scope = 'sessA'
		const id = nextXferId()
		const total = Buffer.alloc(2500)
		for (let i = 0; i < total.length; i++) total[i] = i & 0xFF
		let completed: Buffer | null = null
		startXfer(scope, id, { onComplete: (d) => { completed = d } })

		const r0 = ingestXferChunk(scope, chunkOf(simChunk(id, 0, total.slice(0, 1024), { totalLen: 2500 })))
		expect(r0.status).toBe('ok')
		expect((r0 as { confirmPacket: number }).confirmPacket).toBe(0)

		const r1 = ingestXferChunk(scope, chunkOf(simChunk(id, 1, total.slice(1024, 2048))))
		expect(r1.status).toBe('ok')

		const r2 = ingestXferChunk(scope, chunkOf(simChunk(id, 2, total.slice(2048), { eof: true })))
		expect(r2.status).toBe('done')
		expect((r2 as { confirmPacket: number }).confirmPacket).toBe(2)
		expect(completed).not.toBeNull()
		expect(completed!.length).toBe(2500)
		expect(completed!.equals(total)).toBe(true)
	})

	it('single-packet transfer (packet 0 carries EOF) works', () => {
		const scope = 'sessB'
		const id = nextXferId()
		const payload = Buffer.from('tiny inventory file')
		let completed: Buffer | null = null
		startXfer(scope, id, { onComplete: (d) => { completed = d } })
		const r = ingestXferChunk(scope, chunkOf(simChunk(id, 0, payload, { totalLen: payload.length, eof: true })))
		expect(r.status).toBe('done')
		expect(completed!.toString('utf8')).toBe('tiny inventory file')
	})

	it('re-confirms a resend of the previous chunk, ignores other out-of-order (FS llxfermanager.cpp:566-576)', () => {
		const scope = 'sessC'
		const id = nextXferId()
		startXfer(scope, id, { onComplete: () => {} })
		ingestXferChunk(scope, chunkOf(simChunk(id, 0, Buffer.from('aa'), { totalLen: 4 })))
		// Resend of packet 0 after we advanced → duplicate, must reconfirm packet 0
		const dup = ingestXferChunk(scope, chunkOf(simChunk(id, 0, Buffer.from('aa'), { totalLen: 4 })))
		expect(dup.status).toBe('duplicate')
		expect((dup as { confirmPacket: number }).confirmPacket).toBe(0)
		// Future packet (2 when expecting 1) → ignored, no confirm
		expect(ingestXferChunk(scope, chunkOf(simChunk(id, 2, Buffer.from('cc')))).status).toBe('ignored')
		abortXfer(scope, id)
	})

	it('re-confirms a DEEP duplicate with the highest accepted packet (lost-confirm burst recovery)', () => {
		// A whole burst of our unreliable confirms can vanish; OpenSim then resends from its
		// lastAckPacket+1. Re-confirming with our highest accepted packet fast-forwards its
		// window in one round trip (AckPacket takes max — XferModule.cs:443).
		const scope = 'sessD'
		const id = nextXferId()
		startXfer(scope, id, { onComplete: () => {} })
		ingestXferChunk(scope, chunkOf(simChunk(id, 0, Buffer.alloc(1024), { totalLen: 4096 })))
		ingestXferChunk(scope, chunkOf(simChunk(id, 1, Buffer.alloc(1024))))
		ingestXferChunk(scope, chunkOf(simChunk(id, 2, Buffer.alloc(1024))))
		const dup = ingestXferChunk(scope, chunkOf(simChunk(id, 0, Buffer.alloc(1024), { totalLen: 4096 })))
		expect(dup.status).toBe('duplicate')
		expect((dup as { confirmPacket: number }).confirmPacket).toBe(2)
		abortXfer(scope, id)
	})

	it('unknown xfer id → unknown', () => {
		expect(ingestXferChunk('sessD', chunkOf(simChunk(777n, 0, Buffer.from('x'), { totalLen: 1 }))).status).toBe('unknown')
	})

	it('30s-class idle watchdog fires onTimeout and drops state', async () => {
		const scope = 'sessE'
		const id = nextXferId()
		let timedOut = false
		startXfer(scope, id, { onComplete: () => {}, onTimeout: () => { timedOut = true } }, 20)
		await new Promise((r) => setTimeout(r, 60))
		expect(timedOut).toBe(true)
		// State is gone — a late chunk is 'unknown'
		expect(ingestXferChunk(scope, chunkOf(simChunk(id, 0, Buffer.from('x'), { totalLen: 1 }))).status).toBe('unknown')
	})

	it('clearXferScope drops every transfer of one session only', () => {
		const idA = nextXferId(), idB = nextXferId()
		startXfer('sessF', idA, { onComplete: () => {} })
		startXfer('sessG', idB, { onComplete: () => {} })
		clearXferScope('sessF')
		expect(ingestXferChunk('sessF', chunkOf(simChunk(idA, 0, Buffer.from('x'), { totalLen: 1 }))).status).toBe('unknown')
		expect(ingestXferChunk('sessG', chunkOf(simChunk(idB, 0, Buffer.from('x'), { totalLen: 1 }))).status).not.toBe('unknown')
		abortXfer('sessG', idB)
	})
})
