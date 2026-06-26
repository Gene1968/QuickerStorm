# 2026-06-25 — Template-Driven LLUDP Codec

**Branch:** `ai/template-codec` (off `phase3`). **Commits:** `da8a8d0` → `93e3704`.

## Goal

Stop hand-rolling per-message LLUDP byte math (the source of offset bugs + the
restart-and-pray dev loop). Build ONE template-driven codec like Firestorm /
libopenmetaverse — parse `message_template.msg`, walk message→block→field — so adding a
protocol message is data, not code. Fix the documented always-run misencoding along the way.

## What shipped

New module `server/lib/protocol/`:
- `message_template.msg` — vendored from the FS checkout (committed; re-sync only on LL protocol bumps).
- `types.ts` — `MsgDef`/`BlockDef`/`FieldDef`/`FieldType`.
- `template.ts` — `loadTemplate()` parses the `.msg` into a `byName` + `byFreqId` dictionary; derives the 1/2/4-byte wire prefix from frequency+number.
- `fields.ts` — read/write/sizeOf per wire type. The ONLY place byte math lives.
- `wire.ts` — low-level helpers (UUID, zero-coding, header) extracted from `lludp-codec.ts` so `protocol/` is self-contained (no import cycle). Re-exported from `lludp-codec.ts` for back-compat.
- `codec.ts` — `encode(name, blocks, opts)`, `decode(buf, {alreadyExpanded})`, `messageName(buf)`. Zero-coding covers the message id per LLUDP spec (opt-in on encode; reversed on decode by expanding before reading the id).

Changes:
- All 33 outbound encoders in `lludp-codec.ts` gutted to thin adapters over `encode()` — **no hand-rolled byte math remains**. Call sites + imports unchanged (delegation keeps signatures). Dead `MSG_ID` table removed.
- Dispatcher (`handlers/lludp.ts`): generic decode wired as the front-door for NEW inbound messages (`messageName()` routes; `decode(buf,{alreadyExpanded:true})` walks fields). The 33 existing hand-tuned decoders (incl. the heap-critical firehose) kept as-is — Gene's call: lowest risk to the one subsystem that works. Unknown-packet log now shows the message name.

## 7 latent wire bugs the template caught

The hand-maintained message ids had been silently wrong. The codec fixes all (NEEDS LIVE-VERIFY):

| Message | Was | Correct |
|---|---|---|
| SetAlwaysRun | Low 21 (UserReportInternal) | Low 88 |
| AgentHeightWidth | Low 24 | Low 83 |
| AgentRequestSit | Low 122 | High 6 |
| AgentSit | Low 123 | High 7 |
| ObjectDeGrab | Low 118 (ObjectGrabUpdate) | Low 119 |
| SetStartLocationRequest | Low 204 | Low 324 |
| GrantUserRights | sent ChangeUserRights Low 321, no SessionID | Low 320 + SessionID |

## Validation

- The keystone test (`equivalence.test.ts`) proved generic `encode()` field-data is byte-identical to every original hand-written encoder — offline, no sim. (Now also asserts the corrected ids on the shipping adapters.)
- Pre-existing `lludp-codec.test.ts` (wire-byte assertions written against the original encoders) still passes against the delegating versions — independent confirmation.
- `bun test server/`: 270 pass / 0 fail. `npm run build:prod`: green.

## Why this matters going forward

Adding a new message is now: outbound = `encode('Name', {...})`; inbound = a name-routed case calling `decode()`. No offset math, no per-message restart/test loop. The bespoke blob parsers (ObjectUpdate pos/rot, TextureEntry, Compressed/Terse `Data`) stay hand-tuned — the template can't describe those opaque packed fields under any architecture; they're codec callees, not a second codec.

## Open

- LIVE-VERIFY: always-run sticks (SetAlwaysRun → `ff ff 00 58`), sit-on-object, and the firehose unaffected on a busy region.
- Per-message migration of the existing inbound decoders to the generic path is future, per-feature (not needed now).
