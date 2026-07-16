// src/composables/useUploadActions.js — the ONE place the "upload an asset from disk" actions live, so
// every surface (inventory + menu, MenuBar ▸ Build ▸ Upload, MenuBar ▸ quickerSTORM ▸ Import/Upload) shares
// the same behavior instead of each re-implementing it (the recurring "missed a menu" bug). Uses a
// programmatic file input so no component needs to host a hidden <input>.
import { useAssetUpload } from './useAssetUpload'
import { useInventoryStore } from '@/stores/inventoryStore'
import { useNotifications } from './useNotifications'

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
	const { uploadNewFile } = useAssetUpload()
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

	return { uploadSound }
}
