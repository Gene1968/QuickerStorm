// src/composables/useInventoryThumbnail.js — lazy image previews for inventory items.
//
// thumbnailFor(item) → Ref<string|null>
//   Resolves a texture UUID to an object URL using the existing getTextureUrl() pipeline
//   (IDB → WS fetch → J2C transcode → WebP Blob → createObjectURL).  Returns null until
//   the URL is ready.  Caches by UUID at the module level so every call site shares one
//   in-flight / one result per UUID.
//
// REUSE PATH: getTextureUrl (useTextureFetch.js line 408-418) already handles every cache
// layer (in-memory blobCache, IndexedDB, WS network fetch, hard/soft failure tracking).
// This file is purely a thin Vue ref wrapper + concurrency guard; no new decode logic here.
//
// CONCURRENCY: a separate 4-slot semaphore governs how many WS texture fetches are
// initiated from the inventory UI at once.  The world pipeline owns its own 6-slot cap
// (MAX_INFLIGHT in useTextureFetch); these are additive but the SL asset service is
// load-balanced, so 4 extra slow-path calls for thumbnails have negligible impact while
// the region is loading (inventory load is already deferred until then anyway).
//
// INTEGRATION NOTE (for the orchestrator/Vue layer):
//   In InventoryTreeNode.vue (or whatever item-row component shows thumbnails), add:
//     import { useInventoryThumbnail } from '@/composables/useInventoryThumbnail.js'
//     const { thumbnailFor } = useInventoryThumbnail()
//   Then in the row template:
//     <img v-if="thumbnailFor(item).value" :src="thumbnailFor(item).value"
//          class="w-6 h-6 rounded object-cover" alt="" />
//   Or (better) pre-compute once per row:
//     const thumb = thumbnailFor(item)   // reactive ref, re-uses cached result
//     <img v-if="thumb.value" :src="thumb.value" class="w-6 h-6 rounded object-cover" alt="" />
//   The ref updates from null → URL automatically when the fetch completes.
//   No cleanup required: the object URLs are managed by useTextureFetch's objUrlCache and
//   revoked only by clearTextureCache() / refreshTextures() (engine teardown).

import { ref } from 'vue'
import { getTextureUrl } from './useTextureFetch.js'

// SL/OpenSim asset type 0 = texture (J2C image).  Only these have a fetchable preview.
const ASSET_TYPE_TEXTURE = 0

// Concurrency semaphore — limits how many getTextureUrl WS fetches are started from the
// inventory UI simultaneously (independent of the world pipeline's own MAX_INFLIGHT cap).
const MAX_THUMB_INFLIGHT = 4
let _inflight = 0
const _thumbQueue = []   // { uuid, resolve } — waiting for a slot

function _thumbPump() {
	while (_inflight < MAX_THUMB_INFLIGHT && _thumbQueue.length) {
		_inflight++
		const { uuid, resolve } = _thumbQueue.shift()
		getTextureUrl(uuid)
			.then(resolve, () => resolve(null))
			.finally(() => { _inflight--; _thumbPump() })
	}
}

// Enqueue a getTextureUrl call behind the semaphore.
function _fetchThumb(uuid) {
	return new Promise(resolve => {
		_thumbQueue.push({ uuid, resolve })
		_thumbPump()
	})
}

// Module-level cache: UUID → ref<string|null>.  Shared across all composable call sites —
// creating a second useInventoryThumbnail() instance re-uses the same Map.
const _cache = new Map()   // uuid → Ref<string|null>

// Exposed for tests — resets module state between test runs.
export function _resetThumbnailCache() {
	_cache.clear()
	_inflight = 0
	_thumbQueue.length = 0
}

// Exposed for tests — returns current semaphore state.
export function _thumbSemaphoreState() {
	return { inflight: _inflight, queued: _thumbQueue.length }
}

/**
 * Resolve an inventory item to a reactive object-URL ref.
 * Returns a ref<string|null>.  The ref starts null and updates in place when the URL
 * resolves.  Only texture items (assetType 0) are fetched; everything else returns a
 * permanently-null ref (no network request).
 *
 * Calling thumbnailFor() multiple times with items sharing the same assetId returns the
 * SAME ref instance — safe to call from v-for rows without extra deduplication.
 */
export function thumbnailFor(item) {
	// Only textures can be previewed this way.
	if (!item || item.assetType !== ASSET_TYPE_TEXTURE || !item.assetId) {
		return ref(null)
	}
	const uuid = item.assetId

	if (_cache.has(uuid)) return _cache.get(uuid)

	const r = ref(null)
	_cache.set(uuid, r)

	// Fire-and-forget: populates `r.value` when ready.  No await at call site.
	_fetchThumb(uuid).then(url => { r.value = url ?? null })

	return r
}

export function useInventoryThumbnail() {
	return { thumbnailFor }
}
