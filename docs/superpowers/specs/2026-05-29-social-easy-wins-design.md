# Social Easy-Wins — Design (Phase 3 social baseline)

**Date:** 2026-05-29
**Branch:** phase3
**Status:** As-built design (user authorized building all slices for batch live-test)

## Goal

Surface the rich social data we can already get **without** the risky J2C/texture pivot:
Friends, Groups, Profile (About/Born/Partner/Interests/Groups), live online status,
parcel/place detail, and friend management. Fill the stub UIs that today show
"(none)" / "coming soon".

Texture (J2C), mesh, appearance, web-on-prim remain deferred.

## Architecture

### New store: `gridSocialStore` (Pinia)
Single source of truth for grid-social state. Kept **separate** from `presenceStore`
(which is quickerSTORM web-collab presence — a different concept; mixing corrupts both).

State:
- `friends[]` — `{ id, name, rightsGiven, rightsHas, online }`
- `groups[]` — `{ id, name, title, insignia, powers, acceptNotices, listInProfile }`, `activeGroupId`
- `profiles` — `Map<avatarId, { imageId, flImageId, partnerId, aboutText, flAboutText, bornOn, profileURL, charterMember, flags, interests:{wantToText,skillsText,languagesText,...}, groups:[] }>` (lazy, cached)
- `parcels` — `Map<parcelId, {...ParcelInfoReply fields}>`
- `gestures[]`, `globalTextures`, `loginFlags`

Rights bit flags (SL `LLRelationship`): `1 = can see online`, `2 = can see on map`, `4 = can modify objects`.

### New composable: `useSocial.js`
Sends request envelopes through `useRealtimeSocket`; routes inbound replies into
`gridSocialStore`. Mirrors inventory/map composable pattern. Exposes:
`requestProfile(avatarId)`, `requestParcelInfo(parcelId)`, `offerFriendship(id,name)`,
`respondFriendship(transactionId, accept, folderId)`, `removeFriend(id)`, `setFriendRights(id, rights)`.

### Server (Bun)
1. **Login harvest** — `server/lib/xmlrpc.ts` + `server/handlers/login.ts`: parse
   `buddy-list`, `groups` / `active-group`, `gestures`, `global-textures`, `login-flags`.
   buddy-list/groups are array-of-structs → reuse existing `sliceMemberArray` + `structMember`.
   Add to `LoginResult` + `cachedLoginOk`. Ship under new `social` payload key.
2. **New LLUDP codecs + handlers** (see message table below). Reply packets are
   **zerocoded** → handler zero-decodes (`decodeZeroCoded`) before field parse.

## Message numbers (verified against canonical `data/message_template.msg`)

| Message | Freq/# | Coding | Dir | Layout |
|---|---|---|---|---|
| OnlineNotification | Low 322 | Unencoded | in | AgentBlock **Variable** (U8 count): AgentID LLUUID × N |
| OfflineNotification | Low 323 | Unencoded | in | same |
| AvatarPropertiesRequest | Low 169 | Unencoded | out | AgentData{AgentID, SessionID, AvatarID} |
| AvatarPropertiesReply | Low 171 | Zerocoded | in | AgentData{AgentID,AvatarID}; PropertiesData{ImageID LLUUID, FLImageID LLUUID, PartnerID LLUUID, AboutText Var2, FLAboutText Var1, BornOn Var1, ProfileURL Var1, CharterMember Var1, Flags U32} |
| AvatarInterestsReply | Low 172 | Zerocoded | in | PropertiesData{WantToMask U32, WantToText Var1, SkillsMask U32, SkillsText Var1, LanguagesText Var1} |
| AvatarGroupsReply | Low 173 | Zerocoded | in | GroupData **Variable**{GroupPowers U64, AcceptNotices BOOL, GroupTitle Var1, GroupID LLUUID, GroupName Var1, GroupInsigniaID LLUUID}; NewGroupData{ListInProfile BOOL} |
| ChangeUserRights | Low 321 | Unencoded | out | AgentData{AgentID}; Rights Var{AgentRelated LLUUID, RelatedRights S32} |
| AcceptFriendship | Low 297 | Unencoded | out | AgentData{AgentID,SessionID}; TransactionBlock{TransactionID}; FolderData Var{FolderID} |
| DeclineFriendship | Low 298 | Unencoded | out | AgentData{AgentID,SessionID}; TransactionBlock{TransactionID} |
| TerminateFriendship | Low 300 | Unencoded | out | AgentData{AgentID,SessionID}; ExBlock{OtherID} |
| ParcelInfoRequest | Low 54 | Unencoded | out | AgentData{AgentID,SessionID}; Data{ParcelID} |
| ParcelInfoReply | Low 55 | Zerocoded | in | Data{ParcelID, OwnerID, Name Var1, Desc Var1, ActualArea S32, BillableArea S32, Flags U8, GlobalX/Y/Z F32, SimName Var1, SnapshotID LLUUID, Dwell F32, SalePrice S32, AuctionID S32} |

Field-type sizes: LLUUID=16; U8/BOOL=1; U32/S32/F32=4 (LE); U64=8 (LE);
Variable 1 = U8 length prefix; Variable 2 = U16-LE length prefix. Strings are
null-terminated inside the declared length — strip trailing `\0`.

**OfferFriendship** has no dedicated packet — it is `ImprovedInstantMessage` with
`dialog = 38` (IM_FRIENDSHIP_OFFERED); the IM's id becomes the TransactionID the
peer echoes in Accept/Decline. Reuse existing `encodeImprovedInstantMessage`.

**Picks / Classifieds** deferred — require GenericMessage plumbing + per-pick detail
requests; out of easy-win scope.

## Wire envelopes (`shared/protocol.js`)

`C` (client→server):
`AVATAR_PROPS_REQ {avatarId}`, `PARCEL_INFO_REQ {parcelId}`,
`FRIEND_OFFER {toAgentId, toAgentName, message}`,
`FRIEND_RESPOND {transactionId, accept, folderId}`,
`FRIEND_REMOVE {agentId}`, `FRIEND_RIGHTS {agentId, rights}`.

`S` (server→client):
`SOCIAL_INIT {friends, groups, activeGroupId, gestures, globalTextures, loginFlags}`,
`FRIEND_STATUS {online:boolean, ids:[]}`,
`AVATAR_PROPS {avatarId, properties, interests?, groups?}`,
`PARCEL_INFO {parcel}`.

## Slices (each shippable; ordered low→high risk)

1. **Harvest + store + lists** — `gridSocialStore`, login parse, `SOCIAL_INIT`,
   client populate. Contacts tab + Groups render static-from-login. No new protocol.
2. **Live friend status** — OnlineNotification/OfflineNotification decode → `FRIEND_STATUS`
   → friend online flags update live. MapFloater "Online Friends" filter enabled.
3. **Profile data** — AvatarPropertiesRequest out; decode Properties/Interests/Groups replies
   → `AVATAR_PROPS`. `useSocial.requestProfile`. Fill ProfileFloater tabs.
4. **Parcel info** — ParcelInfoRequest out; decode ParcelInfoReply → `PARCEL_INFO`.
   Surface in Places / About-Land.
5. **Friend mutations (gated)** — offer (IM 38) / accept / decline / terminate / rights.
   Each wired behind a **confirm dialog** — these change the real grid account
   (rights grant others map/edit/see-online). Not silent.

Slices 1–4 read-only; slice 5 mutates the live account.

## UI wiring (existing components, mostly unstub)
- `ConversationsFloater` Contacts tab → real friends list (online dot, IM/Profile/TP/offer-TP/remove).
- `ProfileFloater` → fill About/Born/Partner/Interests/Groups from `gridSocialStore`.
- Groups → list + active-title selector (section in Profile or small GroupsFloater).
- `MapFloater` "Online Friends" filter → enable.
- Profile disabled action buttons → wired (slice 5).

## Risks / notes
- Zerocoded reply decode must run before field parse; verify against existing ObjectUpdate path.
- AvatarGroupsReply field order is unusual (Powers, Notices, Title, ID, Name, Insignia) — follow exactly.
- buddy-list key may vary by grid (OpenSim vs SL) — log parsed members, tolerate absence.
- Friend rights changes are not easily reversible by the peer — confirm dialogs mandatory.
- Not live-verified at build time; user batch-tests against a live grid.
