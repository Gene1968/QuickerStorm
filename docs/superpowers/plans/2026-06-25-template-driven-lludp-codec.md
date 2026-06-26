# Template-Driven LLUDP Codec Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 2552-line hand-rolled LLUDP codec and 33-branch dispatcher with ONE template-driven codec that parses `message_template.msg` and walks message→block→field definitions, so adding a protocol message becomes data (`encode('Name', {...})`) instead of hand-written byte math.

**Architecture:** A runtime template loader (libomv-style) parses the vendored `message_template.msg` into a message dictionary at startup. Field primitives centralize all byte I/O. Generic `encode`/`decode` walk the dictionary. The handful of opaque packed-binary `Variable` fields (ObjectUpdate pos/rot blob, TextureEntry, ExtraParams, PSBlock, Compressed/Terse `Data`) keep their existing hand-tuned parsers, relocated to `protocol/blobs/` and *called by* the one codec — never a parallel codec. The dispatcher decodes once and `switch`es on message name.

**Tech Stack:** TypeScript, Bun runtime, `bun:test`. Server lives in `server/`. New module: `server/lib/protocol/`.

**Reference source:** `C:\Users\gene1\Downloads\Pages\git\phoenix-firestorm\scripts\messages\message_template.msg` (FS), cross-checked against `opensim` and libopenmetaverse `ProtocolManager`.

**Test commands:**
- Protocol/server tests: `bun test server/lib/protocol/` (or a specific file path).
- Full server suite: `bun test server/`
- Build gate: `npm run build:prod`

**Key fact discovered during design:** the current code hardcodes `SetAlwaysRun` as Low 21 (`0x15`) at `server/lib/lludp-codec.ts:30`. Low 21 is actually `UserReportInternal` (Trusted) — the sim drops it. The template says `SetAlwaysRun Low 88`. This is the documented "always run misencoding." The generic codec derives Low 88 automatically. Task 5 treats SetAlwaysRun as the ONE encoder whose generic output intentionally differs from the (buggy) hand-written one.

**Commit style (per CLAUDE.md / memory):** Conventional Commits, subject ≤50 chars. The implementer drafts commits; do NOT push. Gene commits/owns git — but this plan commits locally per task per the superpowers workflow. If Gene's "never auto-commit" preference is active at execution time, replace each `git commit` step with "stage and report; Gene commits."

---

## File Structure

**Create:**
- `server/lib/protocol/message_template.msg` — vendored copy of the FS template (committed).
- `server/lib/protocol/template.ts` — parser: `.msg` text → `Map<name, MsgDef>` + reverse index.
- `server/lib/protocol/types.ts` — `MsgDef`, `BlockDef`, `FieldDef`, `FieldType` interfaces.
- `server/lib/protocol/fields.ts` — read/write primitive per wire type.
- `server/lib/protocol/codec.ts` — `encode(name, blocks, opts)` / `decode(buf)`.
- `server/lib/protocol/blobs/objectData.ts` — packed pos/vel/accel/rot/angvel parser (relocated).
- `server/lib/protocol/blobs/textureEntry.ts` — TextureEntry parser (relocated).
- `server/lib/protocol/blobs/index.ts` — re-exports for blob parsers.
- Tests: `server/lib/protocol/template.test.ts`, `fields.test.ts`, `codec.test.ts`, `equivalence.test.ts`.

**Modify:**
- `server/handlers/lludp.ts` — replace `parseMsgType` + if-chain with `decode` + `switch`.
- `server/lib/lludp-codec.ts` — delete replaced encoders; keep UUID/zero-coding helpers + re-exports of relocated decoders during transition; shrink to helpers + blob glue.
- Call sites of `encodeXxx` across `server/handlers/*.ts` and `server/index.ts` — swap to `encode('Xxx', …)`.

**Do NOT touch:** prim ingest/heap/governor pipeline, J2C/asset paths, terrain LayerData codec (`terrain-codec.ts`), any `src/` composable.

---

## Task 1: Vendor template + type definitions

**Files:**
- Create: `server/lib/protocol/message_template.msg`
- Create: `server/lib/protocol/types.ts`

- [ ] **Step 1: Vendor the template file**

```bash
mkdir -p server/lib/protocol
cp "C:/Users/gene1/Downloads/Pages/git/phoenix-firestorm/scripts/messages/message_template.msg" server/lib/protocol/message_template.msg
```

- [ ] **Step 2: Write the type definitions**

Create `server/lib/protocol/types.ts`:

```typescript
// server/lib/protocol/types.ts — shape of a parsed message_template.msg entry.
export type FieldType =
  | 'U8' | 'U16' | 'U32' | 'U64'
  | 'S8' | 'S16' | 'S32' | 'S64'
  | 'F32' | 'F64'
  | 'LLVector3' | 'LLVector3d' | 'LLVector4' | 'LLQuaternion'
  | 'LLUUID' | 'BOOL' | 'IPADDR' | 'IPPORT'
  | 'Fixed' | 'Variable'

export type Frequency = 'High' | 'Medium' | 'Low' | 'Fixed'
export type BlockQuantity = 'Single' | 'Multiple' | 'Variable'

export interface FieldDef {
  name: string
  type: FieldType
  size?: number   // Fixed N → byte count; Variable N → 1 or 2 (length-prefix width)
}
export interface BlockDef {
  name: string
  quantity: BlockQuantity
  count?: number  // Multiple N → repetition count
  fields: FieldDef[]
}
export interface MsgDef {
  name: string
  frequency: Frequency
  id: number          // message number within its frequency
  idBytes: Buffer     // the 1/2/4-byte wire prefix
  zerocoded: boolean
  trusted: boolean
  blocks: BlockDef[]
}
```

- [ ] **Step 3: Commit**

```bash
git add server/lib/protocol/message_template.msg server/lib/protocol/types.ts
git commit -m "feat(proto): vendor msg template + codec types"
```

---

## Task 2: Template parser

**Files:**
- Create: `server/lib/protocol/template.ts`
- Test: `server/lib/protocol/template.test.ts`

The `.msg` grammar (whitespace-insensitive, `//` line comments):
```
{ <Name> <Freq> <Id> <Trust> <Encoding>
  { <BlockName> <Quantity[ N]>
    { <FieldName> <Type[ Size]> }
    ...
  }
  ...
}
```
`<Freq>` ∈ High/Medium/Low/Fixed. `<Id>` is decimal for High/Medium/Low, hex (e.g. `0xFFFFFFFB`) for Fixed. `<Encoding>` ∈ `Zerocoded`/`Unencoded`. ID→wire-prefix mapping:
- High: 1 byte `[id]`
- Medium: 2 bytes `[0xFF, id]`
- Low: 4 bytes `[0xFF, 0xFF, (id>>8)&0xFF, id&0xFF]`
- Fixed: 4 bytes — the full 32-bit value big-endian (e.g. `0xFFFFFFFB`).

- [ ] **Step 1: Write the failing test**

Create `server/lib/protocol/template.test.ts`:

```typescript
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
    // a couple of fields incl. an opaque Variable
    const te = od.fields.find(f => f.name === 'TextureEntry')!
    expect(te.type).toBe('Variable')
    expect(te.size).toBe(2)
  })

  it('parses PacketAck as Fixed 0xFFFFFFFB', () => {
    const def = proto.byName.get('PacketAck')!
    expect(def.frequency).toBe('Fixed')
    expect([...def.idBytes]).toEqual([0xFF, 0xFF, 0xFF, 0xFB])
  })

  it('parses Multiple N blocks with count', () => {
    // StartLocation / any message with "Multiple 4" — TemplateChanges NeighborBlock Multiple 4
    const anyMultiple = [...proto.byName.values()]
      .flatMap(d => d.blocks)
      .find(b => b.quantity === 'Multiple')
    expect(anyMultiple?.count).toBeGreaterThan(0)
  })

  it('builds a reverse index keyed by freq:id', () => {
    expect(proto.byFreqId.get('Low:88')?.name).toBe('SetAlwaysRun')
    expect(proto.byFreqId.get('High:12')?.name).toBe('ObjectUpdate')
    expect(proto.byFreqId.get('Fixed:0xFFFFFFFB')?.name).toBe('PacketAck')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test server/lib/protocol/template.test.ts`
Expected: FAIL — `loadTemplate` is not defined / module not found.

- [ ] **Step 3: Implement the parser**

Create `server/lib/protocol/template.ts`:

```typescript
// server/lib/protocol/template.ts — parse message_template.msg into a message dictionary.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { MsgDef, BlockDef, FieldDef, Frequency, FieldType, BlockQuantity } from './types.ts'

export interface Protocol {
  byName: Map<string, MsgDef>
  byFreqId: Map<string, MsgDef>   // key `${freq}:${id}` — Fixed id kept as hex string
}

function idBytesFor(freq: Frequency, id: number): Buffer {
  switch (freq) {
    case 'High':   return Buffer.from([id & 0xFF])
    case 'Medium': return Buffer.from([0xFF, id & 0xFF])
    case 'Low':    return Buffer.from([0xFF, 0xFF, (id >> 8) & 0xFF, id & 0xFF])
    case 'Fixed': {
      const b = Buffer.alloc(4); b.writeUInt32BE(id >>> 0, 0); return b
    }
  }
}

// Strip // comments and tokenize into a flat stream of words and braces.
function tokenize(src: string): string[] {
  const noComments = src.replace(/\/\/[^\n]*/g, ' ')
  return noComments.match(/\{|\}|[^\s{}]+/g) ?? []
}

export function parseTemplate(src: string): Protocol {
  const toks = tokenize(src)
  let i = 0
  // skip leading "version 2.0"
  const byName = new Map<string, MsgDef>()
  const byFreqId = new Map<string, MsgDef>()

  const expect = (t: string) => { if (toks[i] !== t) throw new Error(`expected ${t} at ${i}, got ${toks[i]}`); i++ }

  while (i < toks.length) {
    if (toks[i] !== '{') { i++; continue }   // skip version etc.
    // message header: { Name Freq Id Trust Encoding
    expect('{')
    const name = toks[i++]
    const frequency = toks[i++] as Frequency
    const idTok = toks[i++]
    const id = idTok.startsWith('0x') ? parseInt(idTok, 16) : parseInt(idTok, 10)
    i++ // Trust
    const encoding = toks[i++]
    const blocks: BlockDef[] = []
    while (toks[i] === '{') {
      expect('{')
      const blockName = toks[i++]
      const quantity = toks[i++] as BlockQuantity
      let count: number | undefined
      if (quantity === 'Multiple') count = parseInt(toks[i++], 10)
      const fields: FieldDef[] = []
      while (toks[i] === '{') {
        expect('{')
        const fName = toks[i++]
        const fType = toks[i++] as FieldType
        let size: number | undefined
        if (fType === 'Fixed' || fType === 'Variable') size = parseInt(toks[i++], 10)
        expect('}')
        fields.push({ name: fName, type: fType, size })
      }
      expect('}')
      blocks.push({ name: blockName, quantity, count, fields })
    }
    expect('}')
    const def: MsgDef = {
      name, frequency, id, idBytes: idBytesFor(frequency, id),
      zerocoded: encoding === 'Zerocoded', trusted: true, blocks,
    }
    byName.set(name, def)
    const fid = frequency === 'Fixed' ? `Fixed:0x${(id >>> 0).toString(16).toUpperCase()}` : `${frequency}:${id}`
    byFreqId.set(fid, def)
  }
  return { byName, byFreqId }
}

let cached: Protocol | null = null
export function loadTemplate(): Protocol {
  if (cached) return cached
  const here = dirname(fileURLToPath(import.meta.url))
  const src = readFileSync(join(here, 'message_template.msg'), 'utf8')
  cached = parseTemplate(src)
  return cached
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test server/lib/protocol/template.test.ts`
Expected: PASS (5 tests). If the `Multiple` test fails, the file has no `Multiple` block reachable — replace that test body with a direct check on the `TemplateChanges` or `EnableSimulator`-style message; `NeighborBlock Multiple 4` exists per the template.

- [ ] **Step 5: Commit**

```bash
git add server/lib/protocol/template.ts server/lib/protocol/template.test.ts
git commit -m "feat(proto): parse message_template into dict"
```

---

## Task 3: Field primitives

**Files:**
- Create: `server/lib/protocol/fields.ts`
- Test: `server/lib/protocol/fields.test.ts`

Conventions (verified against existing encoders in `lludp-codec.ts`):
- All integers little-endian. `BOOL` = 1 byte. `LLUUID` = 16 bytes (reuse `uuidToBytes`/`bytesToUuid`).
- `LLVector3` = 3×F32LE; `LLVector3d` = 3×F64LE; `LLVector4` = 4×F32LE; `LLQuaternion` = 3×F32LE (w derived — matches `encodeAgentUpdate`).
- `IPADDR` = 4 bytes; `IPPORT` = U16. `Fixed N` = raw N-byte Buffer.
- `Variable 1` = 1-byte LE length prefix; `Variable 2` = 2-byte LE length prefix; value is a raw Buffer.

Each primitive exposes `read(buf, off, size?) → { value, next }` and `write(buf, off, value, size?) → next`. `buf` for writes is pre-sized by the codec (it computes size in a first pass) OR primitives append to a `number[]`/use `Buffer.concat`. **Use the pre-sized-buffer approach**: codec computes byte length, allocates once, primitives write at offset and return next offset (matches existing style, avoids allocations).

- [ ] **Step 1: Write the failing test**

Create `server/lib/protocol/fields.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test'
import { readField, writeField, sizeOfField } from './fields.ts'
import type { FieldDef } from './types.ts'

function roundtrip(def: FieldDef, value: unknown) {
  const size = sizeOfField(def, value)
  const buf = Buffer.alloc(size)
  const end = writeField(buf, 0, def, value)
  expect(end).toBe(size)
  const { value: out, next } = readField(buf, 0, def)
  expect(next).toBe(size)
  return out
}

describe('field primitives', () => {
  it('U8/U16/U32 round-trip little-endian', () => {
    expect(roundtrip({ name: 'a', type: 'U8' }, 200)).toBe(200)
    expect(roundtrip({ name: 'a', type: 'U16' }, 0xBEEF)).toBe(0xBEEF)
    expect(roundtrip({ name: 'a', type: 'U32' }, 0xDEADBEEF)).toBe(0xDEADBEEF)
  })
  it('S8/S16/S32 handle negatives', () => {
    expect(roundtrip({ name: 'a', type: 'S8' }, -5)).toBe(-5)
    expect(roundtrip({ name: 'a', type: 'S32' }, -123456)).toBe(-123456)
  })
  it('U64 round-trips as bigint', () => {
    expect(roundtrip({ name: 'a', type: 'U64' }, 1234567890123n)).toBe(1234567890123n)
  })
  it('F32 round-trips within float precision', () => {
    const v = roundtrip({ name: 'a', type: 'F32' }, 1.5) as number
    expect(v).toBeCloseTo(1.5, 5)
  })
  it('BOOL round-trips', () => {
    expect(roundtrip({ name: 'a', type: 'BOOL' }, true)).toBe(true)
    expect(roundtrip({ name: 'a', type: 'BOOL' }, false)).toBe(false)
  })
  it('LLUUID round-trips', () => {
    const u = '11223344-5566-7788-99aa-bbccddeeff00'
    expect(roundtrip({ name: 'a', type: 'LLUUID' }, u)).toBe(u)
  })
  it('LLVector3 round-trips', () => {
    const out = roundtrip({ name: 'a', type: 'LLVector3' }, [1, 2, 3]) as number[]
    expect(out.map(Math.round)).toEqual([1, 2, 3])
  })
  it('Variable 1 round-trips a buffer with 1-byte length', () => {
    const payload = Buffer.from([1, 2, 3, 4])
    const out = roundtrip({ name: 'a', type: 'Variable', size: 1 }, payload) as Buffer
    expect([...out]).toEqual([1, 2, 3, 4])
  })
  it('Variable 2 round-trips with 2-byte length', () => {
    const payload = Buffer.from(new Array(300).fill(7))
    const out = roundtrip({ name: 'a', type: 'Variable', size: 2 }, payload) as Buffer
    expect(out.length).toBe(300)
  })
  it('Fixed N round-trips raw bytes', () => {
    const payload = Buffer.from([9, 8, 7, 6])
    const out = roundtrip({ name: 'a', type: 'Fixed', size: 4 }, payload) as Buffer
    expect([...out]).toEqual([9, 8, 7, 6])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test server/lib/protocol/fields.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the primitives**

Create `server/lib/protocol/fields.ts`:

```typescript
// server/lib/protocol/fields.ts — read/write one LLUDP wire field. The ONLY place byte math lives.
import type { FieldDef } from './types.ts'
import { uuidToBytes, bytesToUuid } from '../lludp-codec.ts'

const ZERO_UUID = '00000000-0000-0000-0000-000000000000'

export function sizeOfField(def: FieldDef, value: unknown): number {
  switch (def.type) {
    case 'U8': case 'S8': case 'BOOL': return 1
    case 'U16': case 'S16': case 'IPPORT': return 2
    case 'U32': case 'S32': case 'F32': case 'IPADDR': return 4
    case 'U64': case 'S64': case 'F64': return 8
    case 'LLVector3': return 12
    case 'LLVector3d': return 24
    case 'LLVector4': case 'LLQuaternion': return def.type === 'LLVector4' ? 16 : 12
    case 'LLUUID': return 16
    case 'Fixed': return def.size!
    case 'Variable': return (def.size ?? 1) + (value as Buffer).length
  }
}

export function writeField(buf: Buffer, off: number, def: FieldDef, value: unknown): number {
  switch (def.type) {
    case 'U8':  buf.writeUInt8((value as number) & 0xFF, off); return off + 1
    case 'S8':  buf.writeInt8(value as number, off); return off + 1
    case 'BOOL': buf.writeUInt8(value ? 1 : 0, off); return off + 1
    case 'U16': buf.writeUInt16LE((value as number) & 0xFFFF, off); return off + 2
    case 'S16': buf.writeInt16LE(value as number, off); return off + 2
    case 'IPPORT': buf.writeUInt16LE((value as number) & 0xFFFF, off); return off + 2
    case 'U32': buf.writeUInt32LE((value as number) >>> 0, off); return off + 4
    case 'S32': buf.writeInt32LE(value as number, off); return off + 4
    case 'F32': buf.writeFloatLE(value as number, off); return off + 4
    case 'IPADDR': (value as Buffer).copy(buf, off, 0, 4); return off + 4
    case 'U64': buf.writeBigUInt64LE(BigInt(value as bigint | number), off); return off + 8
    case 'S64': buf.writeBigInt64LE(BigInt(value as bigint | number), off); return off + 8
    case 'F64': buf.writeDoubleLE(value as number, off); return off + 8
    case 'LLVector3': { const v = value as number[]; for (let k = 0; k < 3; k++) buf.writeFloatLE(v[k], off + k*4); return off + 12 }
    case 'LLVector3d': { const v = value as number[]; for (let k = 0; k < 3; k++) buf.writeDoubleLE(v[k], off + k*8); return off + 24 }
    case 'LLVector4': { const v = value as number[]; for (let k = 0; k < 4; k++) buf.writeFloatLE(v[k], off + k*4); return off + 16 }
    case 'LLQuaternion': { const v = value as number[]; for (let k = 0; k < 3; k++) buf.writeFloatLE(v[k], off + k*4); return off + 12 }
    case 'LLUUID': uuidToBytes((value as string) || ZERO_UUID).copy(buf, off); return off + 16
    case 'Fixed': (value as Buffer).copy(buf, off, 0, def.size!); return off + def.size!
    case 'Variable': {
      const payload = value as Buffer
      const w = def.size ?? 1
      if (w === 1) buf.writeUInt8(payload.length & 0xFF, off)
      else buf.writeUInt16LE(payload.length & 0xFFFF, off)
      payload.copy(buf, off + w)
      return off + w + payload.length
    }
  }
}

export function readField(buf: Buffer, off: number, def: FieldDef): { value: unknown; next: number } {
  switch (def.type) {
    case 'U8':  return { value: buf.readUInt8(off), next: off + 1 }
    case 'S8':  return { value: buf.readInt8(off), next: off + 1 }
    case 'BOOL': return { value: buf.readUInt8(off) !== 0, next: off + 1 }
    case 'U16': return { value: buf.readUInt16LE(off), next: off + 2 }
    case 'S16': return { value: buf.readInt16LE(off), next: off + 2 }
    case 'IPPORT': return { value: buf.readUInt16LE(off), next: off + 2 }
    case 'U32': return { value: buf.readUInt32LE(off), next: off + 4 }
    case 'S32': return { value: buf.readInt32LE(off), next: off + 4 }
    case 'F32': return { value: buf.readFloatLE(off), next: off + 4 }
    case 'IPADDR': return { value: buf.slice(off, off + 4), next: off + 4 }
    case 'U64': return { value: buf.readBigUInt64LE(off), next: off + 8 }
    case 'S64': return { value: buf.readBigInt64LE(off), next: off + 8 }
    case 'F64': return { value: buf.readDoubleLE(off), next: off + 8 }
    case 'LLVector3': return { value: [buf.readFloatLE(off), buf.readFloatLE(off+4), buf.readFloatLE(off+8)], next: off + 12 }
    case 'LLVector3d': return { value: [buf.readDoubleLE(off), buf.readDoubleLE(off+8), buf.readDoubleLE(off+16)], next: off + 24 }
    case 'LLVector4': return { value: [buf.readFloatLE(off), buf.readFloatLE(off+4), buf.readFloatLE(off+8), buf.readFloatLE(off+12)], next: off + 16 }
    case 'LLQuaternion': return { value: [buf.readFloatLE(off), buf.readFloatLE(off+4), buf.readFloatLE(off+8)], next: off + 12 }
    case 'LLUUID': return { value: bytesToUuid(buf, off), next: off + 16 }
    case 'Fixed': return { value: buf.slice(off, off + def.size!), next: off + def.size! }
    case 'Variable': {
      const w = def.size ?? 1
      const len = w === 1 ? buf.readUInt8(off) : buf.readUInt16LE(off)
      return { value: buf.slice(off + w, off + w + len), next: off + w + len }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test server/lib/protocol/fields.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add server/lib/protocol/fields.ts server/lib/protocol/fields.test.ts
git commit -m "feat(proto): field read/write primitives"
```

---

## Task 4: Generic encode + decode

**Files:**
- Create: `server/lib/protocol/codec.ts`
- Test: `server/lib/protocol/codec.test.ts`

`blocks` argument shape: `{ [blockName]: object | object[] }`. Single blocks accept one object (or a 1-element array); Variable/Multiple accept an array. Decode always returns `blocks[name]` as an **array** of per-instance field objects.

Block count prefix rule (verified against existing code, e.g. `decodeObjectUpdateCached`): **Variable blocks** are preceded by a 1-byte U8 instance count on the wire. **Single** and **Multiple N** blocks have NO count prefix (Single = 1 instance, Multiple = exactly N).

- [ ] **Step 1: Write the failing test**

Create `server/lib/protocol/codec.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test'
import { encode, decode } from './codec.ts'
import { parseHeader } from '../lludp-codec.ts'

const AGENT = '11111111-1111-1111-1111-111111111111'
const SESS  = '22222222-2222-2222-2222-222222222222'

describe('generic codec', () => {
  it('encodes SetAlwaysRun with Low 88 prefix and decodes back', () => {
    const buf = encode('SetAlwaysRun',
      { AgentData: { AgentID: AGENT, SessionID: SESS, AlwaysRun: true } },
      { seq: 5, reliable: true })
    const hdr = parseHeader(buf)
    // body after 6-byte header = 0xFF FF 00 58 (Low 88)
    expect([...buf.slice(hdr.bodyOffset, hdr.bodyOffset + 4)]).toEqual([0xFF, 0xFF, 0x00, 0x58])
    const msg = decode(buf)
    expect(msg.name).toBe('SetAlwaysRun')
    expect(msg.blocks.AgentData[0].AgentID).toBe(AGENT)
    expect(msg.blocks.AgentData[0].AlwaysRun).toBe(true)
  })

  it('round-trips a Variable block (PacketAck Packets)', () => {
    const buf = encode('PacketAck',
      { Packets: [{ ID: 100 }, { ID: 200 }, { ID: 300 }] },
      { seq: 1, reliable: false })
    const msg = decode(buf)
    expect(msg.name).toBe('PacketAck')
    expect(msg.blocks.Packets.map((p: any) => p.ID)).toEqual([100, 200, 300])
  })

  it('does NOT zero-code by default (matches hand-written encoders)', () => {
    const buf = encode('AgentThrottle', {
      AgentData: { AgentID: AGENT, SessionID: SESS, CircuitCode: 12345 },
      Throttle: { GenCounter: 0, Throttles: Buffer.alloc(28) },
    }, { seq: 2, reliable: true })
    expect(parseHeader(buf).zeroCoded).toBe(false)
    const msg = decode(buf)
    expect(msg.blocks.AgentData[0].CircuitCode).toBe(12345)
    expect((msg.blocks.Throttle[0].Throttles as Buffer).length).toBe(28)
  })

  it('zero-codes on opt-in and decode reverses it transparently', () => {
    const buf = encode('AgentThrottle', {
      AgentData: { AgentID: AGENT, SessionID: SESS, CircuitCode: 12345 },
      Throttle: { GenCounter: 0, Throttles: Buffer.alloc(28) },
    }, { seq: 2, reliable: true, zeroCoded: true })
    expect(parseHeader(buf).zeroCoded).toBe(true)
    const msg = decode(buf)
    expect(msg.blocks.AgentData[0].CircuitCode).toBe(12345)
    expect((msg.blocks.Throttle[0].Throttles as Buffer).length).toBe(28)
  })

  it('returns unknown marker for an unrecognized message id', () => {
    const fake = Buffer.from([0x00, 0,0,0,1, 0, 0xFF, 0xFF, 0x7F, 0xFF]) // Low 0x7FFF unused
    const msg = decode(fake)
    expect(msg.unknown).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test server/lib/protocol/codec.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the codec**

Create `server/lib/protocol/codec.ts`:

```typescript
// server/lib/protocol/codec.ts — generic template-driven LLUDP encode/decode.
import { loadTemplate } from './template.ts'
import { readField, writeField, sizeOfField } from './fields.ts'
import { buildHeader, parseHeader, encodeZeroCoded, decodeZeroCoded } from '../lludp-codec.ts'
import type { MsgDef, BlockDef } from './types.ts'

const proto = loadTemplate()

// NOTE: zero-coding is per-packet OPT-IN, not template-mandated. The template's `zerocoded`
// flag marks ELIGIBILITY; existing hand-written encoders deliberately send un-zero-coded bodies.
// `encode` zero-codes ONLY when opts.zeroCoded is true, preserving byte-equivalence (Task 5).
// DECODE is unaffected — it reverses zero-coding based on the HEADER flag, never the template.
export interface EncodeOpts { seq: number; reliable?: boolean; hasAcks?: boolean; zeroCoded?: boolean }
type BlockInput = Record<string, unknown>
type BlocksInput = Record<string, BlockInput | BlockInput[]>

function instances(input: BlockInput | BlockInput[] | undefined): BlockInput[] {
  if (input == null) return []
  return Array.isArray(input) ? input : [input]
}

export function encode(name: string, blocks: BlocksInput, opts: EncodeOpts): Buffer {
  const def = proto.byName.get(name)
  if (!def) throw new Error(`encode: unknown message '${name}'`)

  // Pass 1: size the body (after the message-id prefix).
  let bodyLen = 0
  for (const block of def.blocks) {
    const insts = instances(blocks[block.name])
    if (block.quantity === 'Variable') bodyLen += 1 // U8 count prefix
    for (const inst of insts) for (const f of block.fields) bodyLen += sizeOfField(f, inst[f.name])
  }
  const body = Buffer.alloc(bodyLen)
  let off = 0
  for (const block of def.blocks) {
    const insts = instances(blocks[block.name])
    if (block.quantity === 'Variable') { body.writeUInt8(insts.length & 0xFF, off); off += 1 }
    for (const inst of insts) for (const f of block.fields) off = writeField(body, off, f, inst[f.name])
  }
  // Zero-coding (opt-in): applies to body AFTER the id bytes per LLUDP; id bytes stay raw.
  const zc = !!opts.zeroCoded
  const payload = zc ? Buffer.concat([def.idBytes, encodeZeroCoded(body)]) : Buffer.concat([def.idBytes, body])
  const hdr = buildHeader({ seq: opts.seq, reliable: !!opts.reliable, hasAcks: !!opts.hasAcks, zeroCoded: zc })
  return Buffer.concat([hdr, payload])
}

export interface DecodedMsg {
  name?: string
  unknown?: boolean
  freqId?: string
  blocks: Record<string, Array<Record<string, unknown>>>
}

function lookup(buf: Buffer, off: number): { def?: MsgDef; freqId: string; dataOffset: number } {
  const b0 = buf[off]
  if (b0 !== 0xFF) return { def: proto.byFreqId.get(`High:${b0}`), freqId: `High:${b0}`, dataOffset: off + 1 }
  const b1 = buf[off + 1]
  if (b1 !== 0xFF) return { def: proto.byFreqId.get(`Medium:${b1}`), freqId: `Medium:${b1}`, dataOffset: off + 2 }
  const b2 = buf[off + 2]
  if (b2 !== 0xFF) { const id = buf.readUInt16BE(off + 2); return { def: proto.byFreqId.get(`Low:${id}`), freqId: `Low:${id}`, dataOffset: off + 4 } }
  const hex = `Fixed:0x${buf.readUInt32BE(off).toString(16).toUpperCase()}`
  return { def: proto.byFreqId.get(hex), freqId: hex, dataOffset: off + 4 }
}

export function decode(buf: Buffer): DecodedMsg {
  const hdr = parseHeader(buf)
  let body = buf.slice(hdr.bodyOffset)
  // Find id prefix on the RAW (non-zerocoded) prefix bytes — id bytes are never zero-coded.
  const { def, freqId } = lookup(body, 0)
  if (!def) return { unknown: true, freqId, blocks: {} }
  // Zero-decode only the portion AFTER the id bytes.
  let cursor = def.idBytes.length
  let work = body
  if (hdr.zeroCoded) {
    const decoded = decodeZeroCoded(body.slice(def.idBytes.length))
    work = Buffer.concat([body.slice(0, def.idBytes.length), decoded])
  }
  const out: DecodedMsg = { name: def.name, freqId, blocks: {} }
  let off = cursor
  for (const block of def.blocks) {
    let n = 1
    if (block.quantity === 'Variable') { n = work.readUInt8(off); off += 1 }
    else if (block.quantity === 'Multiple') n = block.count ?? 1
    const arr: Array<Record<string, unknown>> = []
    for (let inst = 0; inst < n; inst++) {
      const rec: Record<string, unknown> = {}
      for (const f of block.fields) {
        if (off >= work.length) break // best-effort on truncation
        const { value, next } = readField(work, off, f)
        rec[f.name] = value
        off = next
      }
      arr.push(rec)
    }
    out.blocks[block.name] = arr
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test server/lib/protocol/codec.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add server/lib/protocol/codec.ts server/lib/protocol/codec.test.ts
git commit -m "feat(proto): generic template encode/decode"
```

---

## Task 5: Equivalence harness — generic output == known-good hand-written bytes

This is the keystone that replaces the restart-and-pray loop. It proves the generic codec emits byte-identical output to the proven-on-the-wire encoders, offline.

**Files:**
- Test: `server/lib/protocol/equivalence.test.ts`

The table below maps each hand-written encoder to its generic `encode(name, blocks)` call. **SetAlwaysRun is the documented exception**: its hand-written form emits Low 21 (buggy); the generic form emits Low 88 (correct). We assert the generic form is correct and that it differs from the buggy one at the id bytes only.

- [ ] **Step 1: Write the equivalence test**

Create `server/lib/protocol/equivalence.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test'
import { encode } from './codec.ts'
import * as hand from '../lludp-codec.ts'

const A = '11111111-1111-1111-1111-111111111111'
const S = '22222222-2222-2222-2222-222222222222'
const seq = 7

// Each case: a name, the hand-written buffer, and the generic call.
// Bodies must match byte-for-byte (header seq/flags identical by construction).
const cases: Array<{ name: string; hand: Buffer; gen: Buffer }> = [
  {
    name: 'UseCircuitCode',
    hand: hand.encodeUseCircuitCode({ agentId: A, sessionId: S, circuitCode: 123, seq }),
    gen: encode('UseCircuitCode', { CircuitCode: { Code: 123, SessionID: S, ID: A } }, { seq, reliable: true }),
  },
  {
    name: 'CompleteAgentMovement',
    hand: hand.encodeCompleteAgentMovement({ agentId: A, sessionId: S, circuitCode: 123, seq }),
    gen: encode('CompleteAgentMovement', { AgentData: { AgentID: A, SessionID: S, CircuitCode: 123 } }, { seq, reliable: true }),
  },
  {
    name: 'LogoutRequest',
    hand: hand.encodeLogoutRequest({ agentId: A, sessionId: S, seq }),
    gen: encode('LogoutRequest', { AgentData: { AgentID: A, SessionID: S } }, { seq, reliable: true }),
  },
  {
    name: 'ChatFromViewer',
    hand: hand.encodeChatFromViewer({ agentId: A, sessionId: S, seq, message: 'hello', chatType: 1, channel: 0 }),
    gen: encode('ChatFromViewer', { AgentData: { AgentID: A, SessionID: S }, ChatData: { Message: Buffer.from('hello', 'utf8'), Type: 1, Channel: 0 } }, { seq, reliable: true }),
  },
  // ... ADD ONE ENTRY PER ENCODER (full list below in Step 3).
]

describe('generic codec matches hand-written encoders byte-for-byte', () => {
  for (const c of cases) {
    it(`${c.name} body matches`, () => {
      // Compare from the message-id prefix onward (skip 6-byte header which is identical).
      expect(c.gen.slice(6).equals(c.hand.slice(6))).toBe(true)
    })
  }
})

describe('SetAlwaysRun is corrected to Low 88 (hand-written was Low 21)', () => {
  it('generic emits 0xFF FF 00 58, not the buggy 0x15', () => {
    const gen = encode('SetAlwaysRun', { AgentData: { AgentID: A, SessionID: S, AlwaysRun: true } }, { seq, reliable: true })
    expect([...gen.slice(6, 10)]).toEqual([0xFF, 0xFF, 0x00, 0x58])
    const bad = hand.encodeSetAlwaysRun({ agentId: A, sessionId: S, seq, alwaysRun: true })
    expect([...bad.slice(6, 10)]).toEqual([0xFF, 0xFF, 0x00, 0x15]) // documents the old bug
  })
})
```

- [ ] **Step 2: Run to verify the seed cases pass (and reveal any field-name/order mismatches)**

Run: `bun test server/lib/protocol/equivalence.test.ts`
Expected: the seed cases PASS. A failure here means the `blocks` mapping for that message doesn't match the wire layout — fix the mapping (field names from the template), not the codec.

- [ ] **Step 3: Fill in the remaining encoder cases**

For EACH encoder below, read its hand-written body in `lludp-codec.ts`, read the message's block/field names from `message_template.msg`, and add a `cases` entry. The block/field NAMES must come from the template (that's what the generic encoder keys on); the VALUES come from the hand-written param object. Encoders to cover (template message name in parens if different):

```
encodeUseCircuitCode (UseCircuitCode)              encodeCompleteAgentMovement (CompleteAgentMovement)
encodeAgentThrottle (AgentThrottle)                encodeAgentHeightWidth (AgentHeightWidth)
encodePacketAck (PacketAck)                        encodeCompletePingCheck (CompletePingCheck)
encodeTeleportLocationRequest (TeleportLocationRequest)
encodeCreateInventoryItem (CreateInventoryItem)    encodeCreateInventoryFolder (CreateInventoryFolder)
encodeRequestMultipleObjects (RequestMultipleObjects)
encodeLogoutRequest (LogoutRequest)                encodeAgentUpdate (AgentUpdate)
encodeImprovedInstantMessage (ImprovedInstantMessage)
encodeObjectSelect (ObjectSelect)                  encodeObjectDeselect (ObjectDeselect)
encodeObjectGrab (ObjectGrab)                      encodeObjectDeGrab (ObjectDeGrab)
encodeAgentRequestSit (AgentRequestSit)            encodeAgentSit (AgentSit)
encodeChatFromViewer (ChatFromViewer)
encodeMapLayerRequest (MapLayerRequest)            encodeMapBlockRequest (MapBlockRequest)
encodeMapNameRequest (MapNameRequest)              encodeAgentSetAppearance (AgentSetAppearance)
encodeRegionHandshakeReply (RegionHandshakeReply)  encodeTeleportLandmarkRequest (TeleportLandmarkRequest)
encodeSetStartLocationRequest (SetStartLocationRequest)
encodeAvatarPropertiesRequest (AvatarPropertiesRequest)
encodeParcelInfoRequest (ParcelInfoRequest)        encodeUUIDNameRequest (UUIDNameRequest)
encodeAcceptFriendship (AcceptCallingCard? — verify: friendship accept is AcceptFriendship)
encodeDeclineFriendship (DeclineFriendship)        encodeTerminateFriendship (TerminateFriendship)
encodeChangeUserRights (GrantUserRights)           encodeAvatarPickerRequest (AvatarPickerRequest)
```

NOTE — encoders whose generic mapping needs care:
- `encodeAgentUpdate`: AgentData block has BodyRotation/HeadRotation as `LLQuaternion` (3 floats), `State` U8, camera vectors `LLVector3`, `Far` F32, `ControlFlags` U32, `Flags` U8. Map the param arrays directly.
- `encodeImprovedInstantMessage`: the computed `ID` (agentID XOR otherID for dialog 0) is a VALUE the caller computes; pass the resulting UUID string as `MessageBlock.ID`. The generic encoder does not replicate that logic — keep the XOR in the call site (see Task 8).
- `encodePacketAck`/`encodeCompletePingCheck`/`encodeAgentThrottle`: verify field names (`Packets.ID`, `PingID`, `Throttle.Throttles`).
- Any encoder where the hand-written body intentionally diverges from the template → document it like SetAlwaysRun rather than forcing equality.

- [ ] **Step 4: Run the full equivalence suite**

Run: `bun test server/lib/protocol/equivalence.test.ts`
Expected: ALL cases PASS except the documented SetAlwaysRun divergence (handled by its own test). Every byte-mismatch is a real wire-layout discovery — resolve by correcting the block mapping, and if the hand-written encoder is the wrong one (like SetAlwaysRun), document it.

- [ ] **Step 5: Commit**

```bash
git add server/lib/protocol/equivalence.test.ts
git commit -m "test(proto): generic==hand-written byte equivalence"
```

---

## Task 6: Relocate blob sub-parsers

Move the opaque-blob parsers OUT of `lludp-codec.ts` into `protocol/blobs/`, **changing only their call signature** (receive a Buffer + offset 0, return structured data) — NOT their parsing logic. Their existing tests must stay green.

**Files:**
- Create: `server/lib/protocol/blobs/objectData.ts`, `textureEntry.ts`, `index.ts`
- Modify: `server/lib/lludp-codec.ts` (cut the moved functions, re-export from blobs for transition)
- Tests: existing `server/__tests__/full-objupdate-decode.test.ts`, `materials-decode.test.ts`, `texture-anim.test.ts`, `flexi-light-decode.test.ts`, `compressed-decode.test.ts`, `material-bump-decode.test.ts` must pass unchanged.

- [ ] **Step 1: Identify the blob functions to move**

In `lludp-codec.ts`: `parseTextureEntryFields` + helpers (`readFaceBitfield`, `readTEField`, `combineFacePairs`, `texGenFromMediaByte`, `bumpFromTEByte`, `mcodeFromMaterialByte`) → `blobs/textureEntry.ts`. The packed pos/rot/vel decoding inside `decodeObjectUpdate`/`decodeImprovedTerseObjectUpdate` → `blobs/objectData.ts` (extract as `parsePackedObjectData(buf, off, len)`).

- [ ] **Step 2: Move textureEntry parsing**

Cut `parseTextureEntryFields` and its private helpers from `lludp-codec.ts` into `server/lib/protocol/blobs/textureEntry.ts`, exporting `parseTextureEntryFields(buf, start, end)` and the public helpers. In `lludp-codec.ts`, replace with `export { parseTextureEntryFields, texGenFromMediaByte, bumpFromTEByte, mcodeFromMaterialByte, combineFacePairs } from './protocol/blobs/textureEntry.ts'` so existing importers keep working.

- [ ] **Step 3: Run the blob tests**

Run: `bun test server/__tests__/full-objupdate-decode.test.ts server/__tests__/materials-decode.test.ts server/__tests__/texture-anim.test.ts server/__tests__/material-bump-decode.test.ts server/__tests__/flexi-light-decode.test.ts`
Expected: PASS — identical results (logic unchanged, only file location + re-export).

- [ ] **Step 4: Run the full server suite to catch import breakage**

Run: `bun test server/`
Expected: same pass count as before this task (no new failures).

- [ ] **Step 5: Commit**

```bash
git add server/lib/protocol/blobs server/lib/lludp-codec.ts
git commit -m "refactor(proto): relocate blob parsers under protocol/"
```

---

## Task 7: Dispatcher cutover

Replace `parseMsgType` + the if-chain in `server/handlers/lludp.ts` with a single `decode(buf)` + `switch (msg.name)`. The firehose cases decode framing generically then call blob parsers.

**Files:**
- Modify: `server/handlers/lludp.ts` (lines ~358 `parseMsgType` and the branch block ~414–1092)

- [ ] **Step 1: Add the generic decode at the dispatch point**

At `server/handlers/lludp.ts:358`, replace:
```typescript
const { type, dataOffset } = parseMsgType(buf, hdr.bodyOffset)
```
with:
```typescript
import { decode } from '../lib/protocol/codec.ts'   // add to imports at top
const msg = decode(buf)
const type = msg.freqId ? msg.freqId.toLowerCase().replace('medium', 'med') : 'unknown' // keep diag counters working
```
Keep the existing `session.msgRxCounts.set(type, …)` diagnostics keyed on `type`.

- [ ] **Step 2: Convert control-message branches to a switch on msg.name**

Replace each `if (type === \`low:${LOW_X}\`)` block with a `case 'X':` reading named fields. Example — RegionHandshake (currently `lludp.ts:443`):
```typescript
switch (msg.name) {
  case 'RegionHandshake': {
    const r = msg.blocks.RegionInfo[0]
    const simName = (r.SimName as Buffer).toString('utf8').replace(/\0/g, '')
    // ... build cachedRegionEnv from named fields (SimAccess, WaterHeight, TerrainDetail0..3, etc.)
    //     mirroring the existing decodeRegionHandshake output, then send REGION_INFO + reply.
    break
  }
  // ... one case per message previously handled
}
```
For each branch, the structured `msg.blocks` replaces the inline `buf.readX(off)` calls. The existing decoder functions (`decodeRegionHandshake`, `decodeChatFromSimulator`, etc.) may be kept and fed `msg` OR inlined — prefer keeping the decoder functions but refactor them to take `(msg: DecodedMsg)` so the offset math is gone. Convert decoders incrementally; each conversion is validated by Step 4's fixture tests.

- [ ] **Step 3: Wire the firehose cases to blob parsers**

```typescript
case 'ObjectUpdate': {
  const region = msg.blocks.RegionData[0]
  for (const o of msg.blocks.ObjectData) {
    const packed = parsePackedObjectData(o.ObjectData as Buffer)   // pos/rot/vel/etc.
    const te = parseTextureEntryFields(o.TextureEntry as Buffer, 0, (o.TextureEntry as Buffer).length)
    // ... assemble the same object record the old decodeObjectUpdate produced, relay as today
  }
  break
}
case 'ObjectUpdateCompressed': {
  for (const o of msg.blocks.ObjectData) {
    const obj = parseCompressedData(o.Data as Buffer, o.UpdateFlags as number) // relocated logic
    // ... relay
  }
  break
}
case 'ImprovedTerseObjectUpdate': {
  for (const o of msg.blocks.ObjectData) {
    const t = parseTerseData(o.Data as Buffer) // relocated logic
    // ... relay
  }
  break
}
```
The blob-parser bodies are the existing logic from `decodeObjectUpdate`/`decodeObjectUpdateCompressed`/`decodeImprovedTerseObjectUpdate`, refactored to take the blob Buffer. Keep ACK queueing, diag counters, interest filtering, and relay calls exactly as they are.

- [ ] **Step 4: Run decode-fixture tests + full suite**

Run: `bun test server/`
Expected: all existing decode tests (`compressed-decode`, `full-objupdate-decode`, `objupdate-crc`, `objupdate-data-var2`, `mapBlockReply`, `regionHandshake`, `eventQueue`, etc.) PASS. These fixtures are the regression net for the cutover.

- [ ] **Step 5: Manual smoke (server starts, parses a live circuit)**

Run the server (`bun run server/index.ts`) against a known region; confirm in `server-watch.log`: RegionHandshake decoded, ObjectUpdate/Terse counts rising, no decode exceptions. (Implementer owns the Bun server + reads logs directly per memory `own-bun-and-watch-logs`.)

- [ ] **Step 6: Commit**

```bash
git add server/handlers/lludp.ts
git commit -m "refactor(lludp): dispatch via generic decode+switch"
```

---

## Task 8: Replace outgoing encoder call sites + delete hand-written encoders

Swap every `encodeXxx(p)` call to `encode('Xxx', {...}, {seq, reliable})`, then delete the now-unused hand-written encoders. SetAlwaysRun's call site automatically gets the Low 88 fix.

**Files:**
- Modify: call sites across `server/handlers/*.ts`, `server/index.ts`, `server/lib/resync.ts`
- Modify: `server/lib/lludp-codec.ts` (delete replaced encoders)

- [ ] **Step 1: Find all encoder call sites**

Run: `grep -rn "encode[A-Z]" server/ --include=*.ts | grep -v lludp-codec.ts | grep -v protocol/`
This lists every call site to convert.

- [ ] **Step 2: Convert call sites one message at a time**

For each, replace the call. Example (SetAlwaysRun):
```typescript
// before
const pkt = encodeSetAlwaysRun({ agentId, sessionId, seq, alwaysRun })
// after
const pkt = encode('SetAlwaysRun', { AgentData: { AgentID: agentId, SessionID: sessionId, AlwaysRun: alwaysRun } }, { seq, reliable: true })
```
For `encodeImprovedInstantMessage`, keep the XOR-session-id computation at the call site, then pass the computed UUID as `MessageBlock.ID`. Re-run the equivalence test's corresponding case mentally as the spec: the body must match what Task 5 validated.

- [ ] **Step 3: Delete the hand-written encoders**

Once a message's call sites are all converted and `bun test server/` is green, delete its `encodeXxx` function from `lludp-codec.ts`. Keep: `uuidToBytes`, `bytesToUuid`, `encodeZeroCoded`, `decodeZeroCoded`, `buildHeader`, `parseHeader`, and the blob-parser re-exports.

- [ ] **Step 4: Verify nothing imports a deleted symbol**

Run: `npm run build:prod` and `bun test server/`
Expected: build green, tests green. A TS error here means a missed call site — convert it.

- [ ] **Step 5: Commit**

```bash
git add server/
git commit -m "refactor(lludp): route all sends through generic encode"
```

---

## Task 9: Final gates + live verification

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `bun test server/`
Expected: green, with MORE tests than the baseline (added: template, fields, codec, equivalence) and ZERO regressions.

- [ ] **Step 2: Build gate**

Run: `npm run build:prod`
Expected: green.

- [ ] **Step 3: Live-verify always-run (the user's original ask)**

Log in to a region. Toggle always-run (the MoveControlsFloater / MenuBar toggle). Confirm in `server-watch.log` that `SetAlwaysRun` is sent with body `ff ff 00 58` and the avatar's run state actually sticks server-side (run speed persists without holding a modifier). This is the proof the Low 88 fix landed.

- [ ] **Step 4: Live-verify the firehose unaffected**

On a known busy region, confirm prim counts populate as before (compare `[PrimDiag]` decoded/relayed rates to a pre-change baseline). No new decode warnings in the log.

- [ ] **Step 5: Update docs**

Mark the always-run item resolved in `docs/FEATURE-GAPS.md`. Add a one-line note to `docs/CONTEXT.md` pointing at `server/lib/protocol/` as the codec home. Record the session in `docs/ai-sessions/2026-06-25-template-driven-codec.md`.

- [ ] **Step 6: Final commit**

```bash
git add docs/
git commit -m "docs: template codec + always-run resolved"
```

---

## Self-Review Notes (filled by plan author)

- **Spec coverage:** template loader (T1–2), field primitives (T3), generic encode/decode (T4), blob parsers relocated as codec callees (T6), dispatcher cutover (T7), encoder replacement/deletion (T8), always-run as first proof (T4 test + T9 live), equivalence-to-known-good-bytes keystone test (T5), all decode fixtures as regression net (T6–7). All spec sections map to tasks.
- **Known divergence documented:** SetAlwaysRun Low 21→88 is handled explicitly in T5 and T9, not silently.
- **Type consistency:** `MsgDef`/`BlockDef`/`FieldDef` defined in T1 used unchanged through T2/T3/T4; `encode(name, blocks, opts)` / `decode(buf)→DecodedMsg` signatures stable T4→T7→T8; `blocks[Name][i].Field` access shape consistent.
- **Open verification item (honest):** the few-dozen newly-wireable messages are NOT individually live-verified here (per spec non-goals); each becomes a one-line `encode`/`case` afterward.
```
