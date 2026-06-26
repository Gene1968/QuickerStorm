import { describe, it, expect } from 'bun:test'
import { loadTemplate } from './template.ts'

const proto = loadTemplate()

describe('template parser', () => {
	it('parses SetAlwaysRun as Low 88 with correct wire prefix', () => {
		const def = proto.byName.get('SetAlwaysRun')!
		expect(def).toBeDefined()
		expect(def.frequency).toBe('Low')
		expect(def.id).toBe(88)
		expect(def.zerocoded).toBe(false)
		expect([...def.idBytes]).toEqual([0xFF, 0xFF, 0x00, 0x58]) // 88 = 0x58
		expect(def.blocks).toHaveLength(1)
		expect(def.blocks[0].name).toBe('AgentData')
		expect(def.blocks[0].quantity).toBe('Single')
		expect(def.blocks[0].fields.map(f => f.name)).toEqual(['AgentID', 'SessionID', 'AlwaysRun'])
		expect(def.blocks[0].fields[2].type).toBe('BOOL')
	})

	it('parses ObjectUpdate as High 12 Zerocoded with Variable ObjectData block', () => {
		const def = proto.byName.get('ObjectUpdate')!
		expect(def.frequency).toBe('High')
		expect(def.id).toBe(12)
		expect(def.zerocoded).toBe(true)
		expect([...def.idBytes]).toEqual([0x0C])
		const od = def.blocks.find(b => b.name === 'ObjectData')!
		expect(od.quantity).toBe('Variable')
		const te = od.fields.find(f => f.name === 'TextureEntry')!
		expect(te.type).toBe('Variable')
		expect(te.size).toBe(2)
	})

	it('parses PacketAck as Fixed 0xFFFFFFFB', () => {
		const def = proto.byName.get('PacketAck')!
		expect(def.frequency).toBe('Fixed')
		expect([...def.idBytes]).toEqual([0xFF, 0xFF, 0xFF, 0xFB])
	})

	it('parses Multiple N blocks with a count', () => {
		const anyMultiple = [...proto.byName.values()]
			.flatMap(d => d.blocks)
			.find(b => b.quantity === 'Multiple')
		expect(anyMultiple).toBeDefined()
		expect(anyMultiple!.count).toBeGreaterThan(0)
	})

	it('builds a reverse index keyed by freq:id', () => {
		expect(proto.byFreqId.get('Low:88')?.name).toBe('SetAlwaysRun')
		expect(proto.byFreqId.get('High:12')?.name).toBe('ObjectUpdate')
		expect(proto.byFreqId.get('Fixed:0xFFFFFFFB')?.name).toBe('PacketAck')
	})

	it('parses Fixed-field sizes (TextColor Fixed 4 in ObjectUpdate)', () => {
		const od = proto.byName.get('ObjectUpdate')!.blocks.find(b => b.name === 'ObjectData')!
		const tc = od.fields.find(f => f.name === 'TextColor')!
		expect(tc.type).toBe('Fixed')
		expect(tc.size).toBe(4)
	})
})
