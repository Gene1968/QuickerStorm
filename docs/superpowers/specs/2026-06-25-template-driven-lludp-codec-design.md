# Template-Driven LLUDP Codec — Design

**Date:** 2026-06-25
**Status:** Approved (design)
**Branch:** off `phase3`

## Problem

The LLUDP codec is hand-rolled per message. `server/lib/lludp-codec.ts` is 2552 lines
of bespoke `Buffer.allocUnsafe` + manual offset arithmetic, one function per message.
`server/handlers/lludp.ts` dispatches with a 129-branch `if (type === 'low:NNN')` chain,
each branch doing inline `buf.readUInt32LE(off); off += 4` decoding.

Consequences:
- Every new message = new hand-written byte math = a get-the-offsets-wrong → restart Bun →
  live-test → wrong-again loop. This is the dominant drag on shipping protocol features.
- Offset bugs are silent: the sim drops a malformed packet with no error, so the only signal
  is "feature doesn't work," diagnosed by hex-dumping live traffic.
- The friction makes each small feature feel like a "big project," and the gaps list grows
  faster than it shrinks.

## How Firestorm / libopenmetaverse solve it

Both are **template-driven**. They load `message_template.msg` (confirmed present at
`phoenix-firestorm/scripts/messages/message_template.msg`) which declares every message's
frequency, ID, trust level, zero-coding, and its ordered blocks → ordered typed fields.
- indra (`LLMessageSystem` / `LLTemplateMessageReader`) reads it at runtime.
- libopenmetaverse (`ProtocolManager`) parses it into a message dictionary.

Encoding/decoding becomes "look up the message def, walk its fields." Adding a message is
**data, not code** — no per-message byte math.

## Decision

Build ONE template-driven codec (libomv-style runtime parse) and cut the entire dispatcher
over to it in a single pass. No coexisting second codec.

### The "one codec" reconciliation (key insight)

The template fully describes **message → blocks → fields** for every message, including the
firehose `ObjectUpdate` (High 12) — which is fully field-described in the template.

What the template does **not** describe — under *any* architecture, because LL packed them
opaquely — is the *contents* of a handful of `Variable` fields that hold a dense binary
sub-format:
- `ObjectUpdate.ObjectData.ObjectData` (Variable 1) — packed position/velocity/accel/rotation/
  angular-velocity, length-discriminated (16/32/48/64 bytes).
- `ObjectUpdate.ObjectData.TextureEntry`, `ExtraParams`, `PSBlock`.
- `ObjectUpdateCompressed.ObjectData.Data` (Variable 2) — entire object packed in one blob.
- `ImprovedTerseObjectUpdate.ObjectData.Data` (Variable 2) — packed terse update.

These sub-formats already have correct, hand-tuned, performance-critical parsers. They are
**not a second codec** — they are blob-content parsers that the one codec *calls* to crack
open a `Variable` field. The generic codec hands them a `Buffer`; they return structured data.

So "keep the hot path fast" and "one codec, done right" are the same thing: the bespoke code
is blob-content parsing, never message framing. Framing — where 100% of the offset bugs and
restart loops live — becomes uniform and template-driven.

## Architecture

New module dir: `server/lib/protocol/`.

### 1. Template loader — `protocol/template.ts`

Parse the vendored `message_template.msg` once at startup into `Map<string, MsgDef>`.

```
MsgDef {
  name: string
  frequency: 'High' | 'Medium' | 'Low' | 'Fixed'
  id: number                 // message number within frequency
  idBytes: Buffer            // the 1/2/4-byte wire prefix (derived from freq+id)
  trust: 'Trusted' | 'NotTrusted'
  zerocoded: boolean         // from 'Zerocoded' | 'Unencoded'
  blocks: BlockDef[]
}
BlockDef {
  name: string
  quantity: 'Single' | 'Multiple' | 'Variable'
  count?: number             // for 'Multiple N'
  fields: FieldDef[]
}
FieldDef {
  name: string
  type: FieldType            // see field primitives
  size?: number              // for 'Fixed N' and 'Variable 1|2'
}
```

Also build a reverse index `freqId → MsgDef` (key e.g. `"High:12"`, `"Low:21"`,
`"Fixed:251"`) for decode dispatch.

**Vendoring:** copy `message_template.msg` into `server/lib/protocol/message_template.msg`
and commit it, so staging/prod (no FS checkout) work. Re-sync only when LL bumps the protocol.

The parser is a small recursive-descent over the `.msg` grammar (brace-nested
`{ Name Freq Id Trust Encoding { Block Quantity { Field Type Size } } }`), skipping `//`
comments and blank lines.

### 2. Field primitives — `protocol/fields.ts`

One read/write pair per wire type. **The single place byte math lives.** Each pair:
`read(buf, off) → { value, next }` and `write(buf, off, value) → next` (or append-to-array
style — chosen during implementation for cleanliness).

Types to support (the set actually used in `message_template.msg`):
`U8, U16, U32, U64, S8, S16, S32, S64, F32, F64, LLVector3, LLVector3d, LLVector4,
LLQuaternion, LLUUID, BOOL, IPADDR, IPPORT, Fixed N, Variable 1, Variable 2`.

- Integers: little-endian (LLUDP convention), matching all existing encoders.
- `LLQuaternion`: 3 floats on the wire (w derived) — matches existing AgentUpdate handling.
- `LLUUID`: 16 bytes, reuse `uuidToBytes` / `bytesToUuid`.
- `Variable 1`: 1-byte length prefix; `Variable 2`: 2-byte LE length prefix; value is a raw
  `Buffer` (the blob boundary). Text fields are Buffers the caller stringifies (SL convention:
  trailing null is included in the length — preserved as-is).
- `Fixed N`: raw N-byte Buffer.

### 3. Generic encode / decode — `protocol/codec.ts`

```
encode(name, blocks, opts) → Buffer
```
- Look up `MsgDef`. Build header via existing `buildHeader` (reliable from `opts.reliable`,
  zeroCoded from `def.zerocoded`). Append `def.idBytes`. Walk `def.blocks`:
  - `Single`: write each field from `blocks[blockName]` (object).
  - `Multiple N` / `Variable`: write count prefix where the wire format requires it (Variable
    blocks carry a U8 count), then each instance from `blocks[blockName]` (array of objects).
  - Each field written via the matching primitive.
- Zero-code the body (after the ID) if `def.zerocoded`, reusing existing `encodeZeroCoded`.

```
decode(buf) → { name, blocks } | { unknown: true, freqId }
```
- `parseHeader` (existing). If `zeroCoded` flag set, `decodeZeroCoded` the body (existing).
- Read freq+id prefix → look up reverse index. Unknown → return marker (dispatcher ignores,
  as today).
- Walk the def, reading each block (Variable blocks read their U8 count first) and each field.
  Variable fields returned as Buffers. Result shape: `blocks[blockName]` is an array of
  per-instance field objects (Single = array length 1, accessed `[0]`).
- Best-effort on truncation, mirroring current decoders (return what parsed; don't throw the
  whole packet away).

### 4. Blob sub-parsers — `protocol/blobs/`

Relocate the existing, proven parsers here **unchanged in logic** (logic moves verbatim;
only its call site changes from inline-offset to "receives a Buffer"):
- `objectData.ts` — the packed pos/vel/accel/rot/angvel blob (length-discriminated).
- `textureEntry.ts` — `parseTextureEntryFields` and its helpers (currently in `lludp-codec.ts`).
- `extraParams.ts`, `psBlock.ts` (PSBlock already in `particleCodec.ts` — wire it as the callee).
- `compressedData.ts` — ObjectUpdateCompressed `Data` blob parser.
- `terseData.ts` — ImprovedTerseObjectUpdate `Data` blob parser.

These keep their hand-tuned performance characteristics. The firehose is unaffected in cost:
generic decode only walks the *outer* fields (cheap) and hands the blob to these.

### 5. Dispatcher cutover — `server/handlers/lludp.ts`

Replace the `parseMsgType` + 129-branch `if` chain with:
```
const msg = decode(buf)
if (msg.unknown) { /* count + ignore, as today */ return }
switch (msg.name) {
  case 'RegionHandshake': { const d = msg.blocks.RegionData[0]; ... }
  case 'ObjectUpdate':    { for (const o of msg.blocks.ObjectData) { parseObjectData(o.ObjectData); parseTextureEntry(o.TextureEntry); ... } }
  ...
}
```
- Control messages read **named fields** (`msg.blocks.AgentData[0].AgentID`) — no offset math.
- Firehose cases decode framing generically, then call the relocated blob parsers.
- Keep all existing per-type RX counters / diag logging keyed on `msg.name`.
- ACK / ping fast paths (`PacketAck`, `StartPingCheck`) may keep their current minimal inline
  handling for latency, but go through `decode` for consistency unless a measurable cost shows.

### 6. Always-run as first proof

Replace `encodeSetAlwaysRun` with `encode('SetAlwaysRun', { AgentData: { AgentID, SessionID,
AlwaysRun: true } })`. A round-trip test (encode → decode → deep-equal) is its regression test.
The control-flags-bit misencoding the codebase already corrected (see `lludp-codec.ts:756`)
stays fixed; this just routes it through the one codec.

### 7. Outgoing encoder replacement

Every hand-written `encodeXxx` in `lludp-codec.ts` is replaced by a call to `encode('Xxx', …)`
at its call sites. The hand-written functions are deleted as each is proven equivalent. End
state: `lludp-codec.ts` retains only UUID/zero-coding helpers and re-exports; all message
framing lives in `protocol/`.

## Testing strategy (this replaces restart-and-pray)

1. **Field primitives**: exhaustive round-trip per type (write→read identity), edge values
   (0, max, negative for signed, 256-zero RLE boundary for Variable).
2. **Template parser**: parse the vendored file; assert known messages decode to expected
   freq/id/blocks (e.g. `SetAlwaysRun` = Low 21, `ObjectUpdate` = High 12, `PacketAck` =
   Fixed 251). Assert field counts for a few representative messages.
3. **Per-message round-trip**: `encode(name, blocks)` → `decode` → deep-equal the blocks.
4. **Equivalence to known-good bytes (the keystone)**: for every currently hand-written
   encoder, assert `encode(name, …)` produces byte-identical output to the existing
   `encodeXxx(...)` for representative inputs. This proves the generic codec matches the
   *proven-on-the-wire* bytes **before** it goes live — no server restart needed to gain
   confidence.
5. **Decode equivalence**: feed captured/synthetic sim packets (reuse existing test fixtures
   in `server/__tests__/`, e.g. `lludp-codec.test.ts`, `full-objupdate-decode.test.ts`,
   `compressed-decode.test.ts`) through the generic decoder; assert the same structured
   output the current decoders produce.
6. **Blob parsers**: their existing tests move with them and must stay green
   (`materials-decode`, `mesh-decode`, `texture-anim`, `flexi-light-decode`, `compressed-*`,
   `particleCodec`, etc.).

`bun test` green + `npm run build:prod` green are the gates. Live-verify always-run +
spot-check the prim firehose on a known region after cutover.

## Scope / non-goals

- **In:** the codec infrastructure (1–4), full dispatcher cutover (5), replacement of all
  currently-used encoders (7), always-run (6), all tests (above). Lands in one pass.
- **Out (explicitly):** live-verifying each of the few-dozen *newly-wireable* messages. After
  this lands, each becomes a one-line `encode(name, blocks)` / `switch` case — wired and
  verified as features need them, not all up front.
- **Not changing:** blob-parser *logic* (relocated, not rewritten); the prim ingest/heap/
  governor pipeline; J2C/asset paths; `usePresence` or any client composable.

## Risks & mitigations

- **Perf regression on firehose** → generic decode only walks cheap outer fields; blob parsers
  unchanged. Mitigate by keeping ACK/ping inline if a hot-path cost shows; equivalence tests
  catch behavioral drift.
- **Template grammar edge cases** (e.g. `Multiple` blocks, `Fixed N`, nested comments) →
  parser unit tests against the real file; fail loud at startup on an unparseable def.
- **Endianness / quaternion / Variable-length-prefix mistakes** → centralized in field
  primitives with exhaustive tests; equivalence-to-known-good-bytes test is the backstop.
- **Big cutover** → the equivalence tests (#4, #5) let us validate the whole cutover against
  known-good bytes/fixtures offline, so "one pass" doesn't mean "untested big bang."
