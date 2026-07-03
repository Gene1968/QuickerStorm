// Watchdog for OpenSim's SILENT Take / Take-copy refusals. A stranger's effective perms are the
// linkset's EffectiveEveryOnePerms — folded over EVERY prim and their contents (opensim
// PermissionsModule.cs:1045) — and take-copy then needs Copy AND Transfer (:2017, :2023); BOTH
// refusal branches send no packet at all (the alert at :2019 is commented out upstream). Without
// this, a blocked take looks like a dead button. Armed on send (useLLUDP.takeObject/
// takeObjectCopy); disarmed by the inventory acks (UpdateCreateInventoryItem / BulkUpdateInventory
// registrations in useInventory). Single timer: a burst of takes keeps one pending hint, and any
// ack in the window clears it — this is a best-effort hint, not per-object tracking.
import { useNotificationStore } from '@/stores/notificationStore'

let timer = null

export function armTakeWatch(label) {
	if (timer) clearTimeout(timer)
	timer = setTimeout(() => {
		timer = null
		useNotificationStore().pushToast({
			kind: 'info',
			title: 'No response from region',
			body: `${label} wasn't confirmed — the object's permissions likely block it. The grid refuses silently: "anyone can copy" must be set on every prim of the object (and its contents), plus transfer for objects you don't own.`,
		})
	}, 10000)
}

export function disarmTakeWatch() {
	if (timer) { clearTimeout(timer); timer = null }
}
