# Caps Framework — Design

**Date:** 2026-06-27
**Status:** Approved (design)
**Branch:** off `phase3`

## Problem

HTTP **capabilities** ("caps") are the request/response and push half of the SL/OpenSim
protocol — everything not carried over LLUDP: inventory fetch/mutate, asset fetch, materials,
profile, region info, appearance upload, group data, and the EventQueue long-poll. Firestorm's
`LLViewerRegionImpl::buildCapabilityNames` (`indra/newview/llviewerregion.cpp:3457`) requests
**~100 caps**.

QuickerStorm's cap layer today is ~30% built and follows a **per-feature bespoke** pattern that
is exactly the pre-codec LLUDP situation:

- **Transport proxy** — `server/handlers/caps.ts` `handleCapsFetch` POSTs a URL, returns raw text.
- **Seed + parse** — `server/handlers/login.ts` POSTs a 14-entry `REQUESTED_CAPS` list to the seed
  cap; the LLSD-XML response is parsed; URLs stored in `session.caps` (Map); `S.CAPS_READY` sent.
- **Server-centric consumers** — `handlers/inventory.ts`, `handlers/assets.ts` (+ J2C transcode),
  `handlers/materials.ts` each hand-build an LLSD request, POST to the resolved cap URL, hand-parse
  the LLSD response, and emit a typed `S.*` message.
- **Inbound EQ** — `server/lib/eventQueue.ts` long-polls and dispatches with a hand-coded
  `switch (message)` (currently TeleportFinish / TeleportFailed / EnableSimulator).
- **LLSD module** — `server/lib/llsd.ts` has `parseLLSD` (decode) + binary decode. There is
  **no general JSON→LLSD-XML *encoder*** (only `encodeLLSDBinaryUuidArray`).

Consequence: every new cap = a new bespoke handler (build LLSD by hand, parse by hand) + new
`C.`/`S.` constants + `server/index.ts` dispatch wiring + a new `switch` arm in EQ. **Every one of
those is a server edit → `bun run --watch` hot-restart → dropped circuit → live re-test.** That
restart-and-pray loop is the dominant drag on shipping cap features — the same drag the
template-driven LLUDP codec removed for messages (see
`docs/superpowers/specs/2026-06-25-template-driven-lludp-codec-design.md`).

## How Firestorm / OpenSim shape it

- FS hand-codes each cap consumer too — there is **no machine-readable "cap template"** to vendor
  (unlike `message_template.msg`). Caps are declared by name in `buildCapabilityNames`, requested
  at the seed, and consumed by bespoke per-feature code.
- The seed POST is itself an LLSD array of requested cap names; the response is an LLSD map of
  `name → URL`. **Cap URLs embed a per-session token** — in FS the viewer holds them because the
  viewer *is* the client.
- The overwhelming majority of caps are **"POST an LLSD map → receive an LLSD map."** A handful are
  special: **binary + HTTP Range** asset caps (`ViewerAsset` / `GetTexture` / `GetMesh`) and the
  **EventQueue** inbound long-poll (a push stream, not request/response).
- OpenSim is **not** SL: no AIS3 (inventory mutations are partly LLUDP), no `AgentProfile` cap
  (profile read/write is LLUDP), no server-bake (client-bake via `UploadBakedTexture` +
  `AgentSetAppearance` UDP), no `RequestTaskInventory` cap on some builds. Many FS caps are simply
  **not offered** by an OpenSim seed — see [[caps-feature-map]].

## Decision

Build a **server-side, call-by-name cap framework** (Approach B) — the cap analog of the LLUDP
codec. The core insight matches the codec: *framing becomes uniform and data-driven; only the
opaque/special transports stay bespoke.*

- The vast majority of caps ("POST an LLSD map → get an LLSD map") are served by a **generic
  JSON↔LLSD round-trip keyed by cap *name***. Adding one of these needs **zero new server code** —
  it is pure client work (one `cap('Name').post({...})` call site). **No Bun restart.**
- The exceptions stay specialized (exactly as the codec kept blob-content parsers): **binary/Range**
  asset caps keep their dedicated handlers + J2C transcode; the **EventQueue** inbound stream
  becomes a data-driven event registry instead of a hand-coded `switch`.
- **Cap URLs and LLSD encode/decode stay server-side.** The client calls by cap *name*; the server
  resolves the token-bearing URL from `session.caps`. Grid session tokens never reach the browser.
  This preserves the existing server-centric architecture decision.

Rejected alternatives:
- **A — client holds URLs (FS-faithful):** most FS-like, but exposes session tokens to the browser
  and moves the LLSD codec client-side, against the server-centric boundary.
- **C — full typed schema per cap (like `message_template`):** no canonical cap template exists to
  vendor; LLSD payloads are far more variable/optional than the rigid UDP message template; ~100
  schemas is high maintenance for marginal gain. YAGNI.

## Architecture

New module dir: `server/lib/caps/`.

### 1. `caps/llsdEncode.ts` — JSON → LLSD-XML (the keystone)

The cap analog of the codec's field primitives: **the single place LLSD serialization lives**,
exhaustively tested offline. Pairs with the existing `parseLLSD` decoder for a full round-trip.

JS → LLSD element mapping:

| JS value | LLSD element |
|----------|--------------|
| plain object | `<map>` with `<key>…</key>` per entry |
| array | `<array>` |
| string | `<string>` |
| boolean | `<boolean>` |
| `null` / `undefined` | `<undef/>` |
| number | `<integer>` if `Number.isInteger(n)`, else `<real>` |

**Number-type ambiguity** (LLSD splits `<integer>` vs `<real>`; JS has one number type) is resolved
with explicit typed wrappers that override the default: `llsd.int(n)`, `llsd.real(n)`,
`llsd.uuid(s)`, `llsd.uri(s)`, `llsd.date(d)`, `llsd.binary(buf)`, `llsd.bool(b)`. These mirror how
the codec field primitives are explicit about wire type. Output is `application/llsd+xml` with the
`<?xml …?><llsd>…</llsd>` envelope. Entity-encode `& < >` in string/key content.

### 2. `caps/registry.ts` — caps as data

```
CapDef {
  name: string                       // 'CreateInventoryCategory'
  method?: 'POST' | 'GET'            // default 'POST'
  kind: 'llsd' | 'binary'            // 'llsd' = generic round-trip; 'binary' = dedicated handler
  request?:  (params: any) => LLSDValue   // optional; default identity (params already LLSD-shaped)
  response?: (llsd: LLSDValue) => any      // optional; default identity (return decoded LLSD)
}
```

Key move: **a plain LLSD cap needs no registry entry at all.** The gate for "may I call this cap?"
is *"is the name present in `session.caps`?"* — i.e. the grid offered it **and** we requested it —
**not** "is it in the registry." The registry holds entries only for caps that need server-side
shaping (e.g. inventory perms-bit extraction) or are `kind: 'binary'`. An offered-but-unregistered
cap is callable via the default `llsd` behavior (identity request, decoded-LLSD response). This is
what makes adding a standard cap require zero server code.

### 3. `caps/invoke.ts` — generic call path

```
invokeCap(session, id, capName, params, method?) → void   // replies async over the session WS
```

1. Resolve URL from `session.caps`. Missing → reply `S.CAP_RESULT { id, cap, ok:false,
   error:'cap_unavailable' }`.
2. Look up the registry entry (if any). If `kind:'binary'`, route to the dedicated binary handler
   instead (the generic LLSD path is not used for binary caps).
3. Apply `request` shaper or identity → `encodeLLSD(payload)`.
4. `fetch(url, { method, headers: llsd+xml, body })`.
5. `parseLLSD(responseText)` → apply `response` shaper or identity.
6. Reply `S.CAP_RESULT { id, cap, ok:true, result }`. On HTTP/parse error → `S.CAP_RESULT
   { id, cap, ok:false, error, status }`.

Mirrors the LLUDP-decode→typed-JSON pattern already used across the server.

### 4. Protocol — one generic pair

`shared/protocol.js` gains:
- `C.CAP_CALL { id, cap, params, method? }` — client → server, one message for **all** caps.
- `S.CAP_RESULT { id, cap, ok, result? , error?, status? }` — server → client, correlated by `id`.

`server/index.ts` dispatch routes `C.CAP_CALL` → `invokeCap`. The existing semantic per-feature
constants (`C.INV_FETCH_FOLDER` → `S.INV_FOLDER`) **stay working** during migration — their handler
is reimplemented on top of `invokeCap` — and are removed once the client moves to `cap('…').post()`.
The raw URL proxy (`C.CAPS_FETCH` / `S.CAPS_RESULT`) is left untouched and deprecated in place (it is
URL-based, not name-based, so it is orthogonal to the new path). No flag-day break.

### 5. Client `useCaps.js` — single front door

A singleton composable (mounted session-long in `WorldView`, like `useInventory`):
- `cap(name).post(params)` / `cap(name).get(params)` → returns a **Promise** correlated by a
  generated `id`; resolves on the matching `S.CAP_RESULT`, rejects on `ok:false` or a 30s timeout.
- Tracks `capsReady` (Set) from `S.CAPS_READY`; `cap(name)` can pre-check availability.

This is the client-side equivalent of `encode('Name', {...})`: wiring a new cap call is one line.

### 6. Inbound half: data-driven EventQueue

Replace `eventQueue.ts`'s hand-coded `switch (message)` with an `eqRegistry: Map<eventName,
(session, body) => void>`:
- **Registered** events (TeleportFinish, TeleportFailed, EnableSimulator, …) keep their bespoke
  server-side logic, moved into registry handlers.
- **Unregistered** events are **forwarded generically** to the client as `S.EQ_EVENT { name, body }`
  (LLSD→JSON). So reacting to a new EQ event is client-only work — **no restart** — unless it needs
  server-side logic, in which case it gets a registry handler (a restart, but only then).

### 7. Migration + broaden the seed list

Migrate the three existing consumers onto the framework (the proof it works against real code):
- **`handlers/inventory.ts`** — `FetchInventoryDescendents2` has real server-side shaping
  (builds the folders array; extracts items, perms bits COPY/MODIFY/TRANSFER, `createdAt`). That
  shaping moves into registry `request`/`response` functions; the handler shrinks to an `invokeCap`
  call. Behavior (including the `fetch_folders=1` fix and batch-folder array support) preserved.
- **`handlers/materials.ts`** — `RenderMaterials` / `ModifyMaterialParams` become registry entries
  + `invokeCap`.
- **`handlers/assets.ts` + J2C** — declared `kind:'binary'` in the registry (single source of truth
  for which transport a cap uses); **logic untouched**, still routed to the dedicated binary handler.

**`REQUESTED_CAPS`** (`login.ts`) expands from 14 toward the FS set for roadmap families, kept
alphabetical like FS to reduce merge noise:
- inventory mgmt: `CreateInventoryCategory`, `CopyInventoryFromNotecard`, `IncrementCOFVersion`,
  `InventoryThumbnailUpload`
- object interaction: `RequestTaskInventory`, `ObjectMedia`, `ObjectMediaNavigate`,
  `GetObjectCost`, `GetObjectPhysicsData`, `ResourceCostSelected`
- profile / agent: `AgentProfile`, `UserInfo`, `UpdateAgentInformation`, `GetDisplayNames`
- region / parcel: `SimulatorFeatures`, `ParcelVoiceInfoRequest`, `RemoteParcelRequest`,
  `ParcelPropertiesUpdate`
- appearance: `UpdateAvatarAppearance`, `UploadBakedTexture` (already present)

Requesting a cap is free (it just asks the seed); we are not obligated to consume it. OpenSim will
omit the ones it does not implement → `cap_unavailable` is the correct graceful degradation, handled
uniformly by the framework. Exact final list finalized during implementation against the live seed
response; the above is the target, not a contract.

## Testing strategy (offline — replaces restart-and-pray)

1. **`llsdEncode`**: exhaustive per-type round-trip (`parseLLSD(encodeLLSD(x))` identity) for every
   type incl. the typed wrappers; edge values (empty map/array, nested, unicode + entity chars,
   integer-vs-real boundary, binary). Plus **golden-string** tests asserting byte-exact request
   bodies against real OpenSim cap request examples (the equivalence-to-known-good keystone).
2. **`invoke`**: mocked `fetch` — assert URL resolution from `session.caps`, request shaping,
   `encodeLLSD` body, response decode/shaping, and every error shape (`cap_unavailable`, HTTP
   non-2xx, unparseable LLSD).
3. **registry shapers**: pure-function unit tests — inventory `request`/`response` against a captured
   `FetchInventoryDescendents2` response fixture (reuse existing inventory fixtures); assert the same
   typed items + perms + `createdAt` the current handler produces.
4. **EQ dispatch**: feed captured EQ bodies through the new dispatch — assert bespoke handling for
   registered events and generic `S.EQ_EVENT` forward for unregistered ones.

Gate: `bun test` green + `npm run build:prod` green. **Live-verify once after cutover** (the thesis
proof): (a) inventory still loads correctly through the migrated path, and (b) one brand-new cap call
(e.g. `CreateInventoryCategory` or a profile read) works wired as **client-only** code with zero
further server restarts.

## Workflow

Server-heavy pass. Per `CLAUDE.md`: batch **all** server edits in one burst, reclaim/own the Bun WS
server and watch `server-watch.log` directly, restart once, tell the user "server settled —
reconnect," then do client edits (Vite HMR keeps the circuit). The user drives the client only for
the single end-of-pass live-verify. Vite runs on **5174** (user owns it). Do not interleave server
saves with live testing.

## Scope / non-goals

- **In:** `llsdEncode`, `registry`, `invoke`, the `C.CAP_CALL`/`S.CAP_RESULT` pair + dispatch,
  client `useCaps`, data-driven EQ dispatch, migration of the three existing consumers, broadening
  `REQUESTED_CAPS`, and all tests above. Lands in one pass.
- **Out (explicitly):** implementing the full ~100-cap surface — the framework makes each a cheap
  client-only addition, wired as features need them, not up front. No per-cap typed schema
  (Approach C). No client-side LLSD codec (server-centric chosen). No change to binary asset
  *logic* (declared/relocated only). No change to `usePresence`, the prim ingest/heap/governor
  pipeline, or the LLUDP codec.

## Risks & mitigations

- **LLSD encoder correctness** (number typing, entity escaping, binary) → centralized in one module
  with exhaustive round-trip + golden-string tests; the golden tests are the backstop, validated
  offline before going live.
- **A cap the grid offers but with an unexpected response shape** → identity-decode returns the raw
  LLSD-as-JSON; the client shapes it, and a registry `response` fn can be added later without
  touching the generic path.
- **EQ regression on the working teleport path** → registered handlers keep verbatim logic; captured
  -body tests assert no behavioral drift before cutover.
- **OpenSim omits requested caps** → `cap_unavailable` is the designed, uniform degradation; not an
  error condition.
- **Migration breaking inventory** → fixture-based shaper tests assert byte-for-byte the same typed
  output as the current handler before the old constants are removed; old constants stay aliased
  through the transition.

## References

- `docs/superpowers/specs/2026-06-25-template-driven-lludp-codec-design.md` — the codec framework
  this mirrors.
- `docs/superpowers/specs/2026-06-03-caps-feature-map.md` — full FS→OpenSim cap/packet trace and
  dependency-ordered slice plan; [[caps-feature-map]], [[phase3-inventory-and-cap-state]].
- `indra/newview/llviewerregion.cpp:3457` (`buildCapabilityNames`) — FS's authoritative cap list.
- `server/lib/llsd.ts`, `server/handlers/{caps,login,inventory,assets,materials}.ts`,
  `server/lib/eventQueue.ts` — current cap layer.
