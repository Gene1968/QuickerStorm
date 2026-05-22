// server/lib/circuit.ts — circuit sequence numbers, ack queue, reliable retransmit
import type { CircuitState } from '../state/sessions'
import { encodePacketAck } from './lludp-codec'

const MAX_RETRIES    = 5
const RETRY_INTERVAL = 1000  // ms before first retry

/** Increment and return next sequence number; wraps at 0xFFFFFFFF, never returns 0 */
export function nextSeq(s: CircuitState): number {
  s.seqNum = (s.seqNum >= 0xFFFFFFFF) ? 1 : s.seqNum + 1
  return s.seqNum
}

/** Queue an incoming reliable packet ID for acking back to sim */
export function queueAck(s: CircuitState, seq: number): void {
  s.pendingAcks.push(seq)
}

/** Return and clear the pending ack list */
export function flushAcks(s: CircuitState): number[] {
  const acks = [...s.pendingAcks]
  s.pendingAcks = []
  return acks
}

/** Track an outgoing reliable packet for potential retransmit */
export function trackReliable(s: CircuitState, seq: number, buf: Buffer): void {
  s.reliableOut.set(seq, { buf, sentAt: Date.now(), retries: 0 })
}

/** Remove a reliable packet when the sim acks it */
export function ackReceived(s: CircuitState, seq: number): void {
  s.reliableOut.delete(seq)
}

/** Called on a timer — retransmit overdue reliable packets, drop after MAX_RETRIES */
export function retransmitOverdue(s: CircuitState): void {
  const now = Date.now()
  for (const [seq, entry] of s.reliableOut) {
    const due = entry.sentAt + RETRY_INTERVAL * Math.pow(2, entry.retries)
    if (now < due) continue
    if (entry.retries >= MAX_RETRIES) {
      console.warn(`[circuit] dropping reliable seq ${seq} after ${MAX_RETRIES} retries`)
      s.reliableOut.delete(seq)
      continue
    }
    entry.retries++
    entry.sentAt = now
    s.udpSocket.send(entry.buf, s.simPort, s.simIp)
  }
}

/** Send queued acks to sim if any pending. Call before sending other packets. */
export function sendPendingAcks(s: CircuitState): void {
  const acks = flushAcks(s)
  if (acks.length === 0) return
  const seq = nextSeq(s)
  const buf = encodePacketAck(acks, seq)
  s.udpSocket.send(buf, s.simPort, s.simIp)
}
