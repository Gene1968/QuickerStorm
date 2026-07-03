// Resolve a clicked prim to its linkset ROOT localId. OpenSim's DeRezObjects silently SKIPS any
// DeRezObject entry that isn't the linkset root — "Can't delete child prims", a bare `continue`
// with no reply of any kind (opensim Scene.Inventory.cs:2258-2260, BEFORE the permission checks).
// So Take / Take copy / Delete on a child prim of a linked build looks like a dead click.
// Firestorm never hits this: right-click selects the OBJECT and derez_objects sends the root's
// localId. Walk parentId upward; stop at an avatar parent (attachment / sit — never derez through
// an avatar) or an unknown id (parent not in the object map yet → best effort, send what we have).
import { PCODE_AVATAR } from '@/stores/worldStore'

export function linksetRootLocalId(objects, localId) {
	let cur = localId
	const seen = new Set()
	while (!seen.has(cur)) {
		seen.add(cur)
		const p = objects.get(cur)?.parentId
		if (!p) break
		const parent = objects.get(p)
		if (!parent || parent.pcode === PCODE_AVATAR) break
		cur = p
	}
	return cur
}
