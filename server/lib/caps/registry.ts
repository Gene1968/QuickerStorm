// server/lib/caps/registry.ts — caps as data. A cap NOT registered here is still callable by
// name through the generic path (identity request, decoded-LLSD response) IF the grid offered it.
// The registry holds only caps that need server-side shaping. DEDICATED_CAPS lists caps owned by
// bespoke handlers (binary/zlib transports) — the generic path refuses those.
import type { LLSDValue } from '../llsd'

export interface CapDef {
	name: string
	method?: 'POST' | 'GET'
	request?:  (params: any) => any         // JS value → request payload (encodeLLSD'd by runCap)
	response?: (llsd: LLSDValue) => any      // decoded LLSD → typed JS for the client
}

const REGISTRY = new Map<string, CapDef>()

export function registerCap(def: CapDef): void { REGISTRY.set(def.name, def) }
export function getCapDef(name: string): CapDef | undefined { return REGISTRY.get(name) }

// Caps served by dedicated handlers, NOT the generic LLSD round-trip:
//   ViewerAsset/GetTexture/GetMesh/GetMesh2 — binary + HTTP Range asset fetch (handlers/assets.ts)
//   RenderMaterials/ModifyMaterialParams   — zlib-wrapped LLSD *binary* (handlers/materials.ts)
export const DEDICATED_CAPS = new Set<string>([
	'ViewerAsset', 'GetTexture', 'GetMesh', 'GetMesh2',
	'RenderMaterials', 'ModifyMaterialParams',
])
