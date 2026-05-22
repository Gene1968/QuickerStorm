import { describe, it, expect } from 'bun:test'
import { nextSeq, queueAck, flushAcks, trackReliable, ackReceived } from '../lib/circuit'
import type { CircuitState } from '../state/sessions'

function makeState(): Partial<CircuitState> {
  return { seqNum: 0, pendingAcks: [], reliableOut: new Map() }
}

describe('nextSeq', () => {
  it('increments and wraps at 0xFFFFFFFF', () => {
    const s = makeState() as CircuitState
    expect(nextSeq(s)).toBe(1)
    expect(nextSeq(s)).toBe(2)
    s.seqNum = 0xFFFFFFFF
    expect(nextSeq(s)).toBe(1)  // wraps, never returns 0
  })
})

describe('ack queue', () => {
  it('queues and flushes acks', () => {
    const s = makeState() as CircuitState
    queueAck(s, 10)
    queueAck(s, 11)
    const flushed = flushAcks(s)
    expect(flushed).toEqual([10, 11])
    expect(s.pendingAcks).toHaveLength(0)
  })
})

describe('reliable tracking', () => {
  it('tracks sent packet and removes on ack', () => {
    const s = makeState() as CircuitState
    const buf = Buffer.from([1, 2, 3])
    trackReliable(s, 5, buf)
    expect(s.reliableOut.has(5)).toBe(true)
    ackReceived(s, 5)
    expect(s.reliableOut.has(5)).toBe(false)
  })
})
