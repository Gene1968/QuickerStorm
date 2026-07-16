// src/composables/useUploadActions.js — the ONE place the "upload an asset from disk" actions live, so
// every surface (inventory + menu, MenuBar ▸ Build ▸ Upload, MenuBar ▸ quickerSTORM ▸ Import/Upload) shares
// the same behavior instead of each re-implementing it (the recurring "missed a menu" bug). Uses a
// programmatic file input so no component needs to host a hidden <input>.
import { useAssetUpload } from './useAssetUpload'
import { useInventoryStore } from '@/stores/inventoryStore'
import { useNotifications } from './useNotifications'

// Round a dimension to the nearest power of two, clamped to [8, 1024]. FS scales upload textures to
// power-of-two dims (LLViewerTextureList::createUploadFile) capped at 1024²; the grid/GPU expect PoT.
function nearestPoT(n) {
	const p = Math.pow(2, Math.round(Math.log2(Math.max(1, n))))
	return Math.max(8, Math.min(1024, p))
}

// Decode a browser-readable image File (png/jpg/gif/webp/bmp) → raw interleaved pixels for J2C upload.
// Scales to PoT ≤1024, and drops the alpha channel when the image is fully opaque (SL stores opaque
// textures as 3-component J2C — sending RGBA there would needlessly mark the texture transparent).
async function decodeImageToPixels(file) {
	const bmp = await createImageBitmap(file)
	const w = nearestPoT(bmp.width), h = nearestPoT(bmp.height)
	const canvas = document.createElement('canvas')
	canvas.width = w; canvas.height = h
	const ctx = canvas.getContext('2d', { willReadFrequently: true })
	ctx.drawImage(bmp, 0, 0, w, h)
	bmp.close?.()
	const rgba = ctx.getImageData(0, 0, w, h).data   // Uint8ClampedArray, RGBA
	let opaque = true
	for (let i = 3; i < rgba.length; i += 4) { if (rgba[i] < 255) { opaque = false; break } }
	if (opaque) {
		const rgb = new Uint8Array(w * h * 3)
		for (let s = 0, d = 0; s < rgba.length; s += 4) { rgb[d++] = rgba[s]; rgb[d++] = rgba[s + 1]; rgb[d++] = rgba[s + 2] }
		return { pixels: rgb, w, h, channels: 3 }
	}
	return { pixels: new Uint8Array(rgba.buffer.slice(0)), w, h, channels: 4 }
}

// Open a native file picker and resolve with the chosen File (or null if cancelled/none).
function pickFile(accept) {
	return new Promise(resolve => {
		const el = document.createElement('input')
		el.type = 'file'
		el.accept = accept
		el.style.display = 'none'
		el.addEventListener('change', () => { const f = el.files?.[0] || null; el.remove(); resolve(f) }, { once: true })
		document.body.appendChild(el)
		el.click()
	})
}

export function useUploadActions() {
	const { uploadNewFile, uploadNewImage } = useAssetUpload()
	const inv = useInventoryStore()
	const { notifyInfo, notifyError } = useNotifications()

	// Target folder for an upload of FolderType `sysType`: the folder you have selected, else that type's
	// system folder (FS routes uploads there), else root. Fixes "landed at root" when nothing's selected.
	function targetFolder(sysType) {
		const sel = inv.resolveTargetFolder()
		if (sel && sel !== inv.rootId) return sel
		return inv.systemFolder(sysType) || sel || inv.rootId
	}

	// Upload a sound (OGG) from disk. SL sound assets are OGG Vorbis; we don't transcode, so accept .ogg only.
	async function uploadSound() {
		const file = await pickFile('.ogg,audio/ogg')
		if (!file) return
		const base = (file.name || 'Sound').replace(/\.[^.]+$/, '') || 'Sound'
		const folderId = targetFolder(1)   // FolderType 1 = Sounds
		notifyInfo('Uploading', `Uploading "${base}"…`)
		const res = await uploadNewFile({ kind: 'sound', name: base, folderId, bytes: await file.arrayBuffer() })
		if (res?.ok) {
			// Show it immediately in the target folder rather than waiting on a hard reload — the sim's
			// inventory-add can arrive as a BulkUpdate that doesn't land a fresh row in an unfetched folder.
			// De-duped by itemId if the sim's update also arrives. (assetType/invType 1 = Sound.)
			if (res.itemId) {
				inv.addCreatedItems([{
					itemId: res.itemId, parentId: folderId, name: base, desc: '',
					assetType: 1, invType: 1, assetId: res.assetId || '',
					flags: 0, ownerMask: 0x7FFFFFFF, nextOwnerMask: 0x7FFFFFFF,
				}])
			}
			notifyInfo('Uploaded', `Sound "${base}" added to inventory.`)
		} else {
			notifyError('Upload failed', res?.error || 'The grid rejected the upload.')
		}
	}

	// Upload a texture (image) from disk. Browser decodes any common format; the server encodes to J2C.
	async function uploadTexture() {
		const file = await pickFile('image/png,image/jpeg,image/gif,image/webp,image/bmp,.png,.jpg,.jpeg,.gif,.webp,.bmp')
		if (!file) return
		const base = (file.name || 'Texture').replace(/\.[^.]+$/, '') || 'Texture'
		const folderId = targetFolder(0)   // FolderType 0 = Textures
		notifyInfo('Uploading', `Encoding & uploading "${base}"…`)
		let img
		try {
			img = await decodeImageToPixels(file)
		} catch (e) {
			notifyError('Upload failed', `Could not read the image: ${e?.message || e}`)
			return
		}
		const res = await uploadNewImage({ name: base, folderId, ...img })
		if (res?.ok) {
			// Show it immediately (see uploadSound rationale). assetType/invType 0 = Texture.
			if (res.itemId) {
				inv.addCreatedItems([{
					itemId: res.itemId, parentId: folderId, name: base, desc: '',
					assetType: 0, invType: 0, assetId: res.assetId || '',
					flags: 0, ownerMask: 0x7FFFFFFF, nextOwnerMask: 0x7FFFFFFF,
				}])
			}
			notifyInfo('Uploaded', `Texture "${base}" (${img.w}×${img.h}) added to inventory.`)
		} else {
			notifyError('Upload failed', res?.error || 'The grid rejected the upload.')
		}
	}

	return { uploadSound, uploadTexture }
}
