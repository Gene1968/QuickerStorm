/**
 * Parody delivery carriers for the front-desk delivery bot system.
 *
 * Names are intentionally one-letter swaps off real couriers so they read
 * "as if" you'd recognize the brand at a glance, without using the real one.
 * Color palettes mirror the originals so the package-label canvas textures
 * read like the right brand.
 */

export const DELIVERY_CARRIERS = [
	{
		id: 'amazoom',
		name: 'Amazoom',
		primary: '#FF9900',     // Amazon orange
		secondary: '#232F3E',   // Amazon dark slate
		text: '#000000',
		tagline: 'Smile, package on the way',
	},
	{
		id: 'oops',
		name: 'OOPS',
		primary: '#5C3A1E',     // UPS brown
		secondary: '#FFB500',   // UPS gold
		text: '#FFB500',
		tagline: "What can brown 'oops' for you?",
	},
	{
		id: 'uspf',
		name: 'USPF',
		primary: '#004B87',     // USPS blue
		secondary: '#DA291C',   // USPS red
		text: '#FFFFFF',
		tagline: 'Postage Affixed',
	},
	{
		id: 'bhl',
		name: 'BHL',
		primary: '#FFCC00',     // DHL yellow
		secondary: '#D40511',   // DHL red
		text: '#D40511',
		tagline: 'Express. Approximately.',
	},
	{
		id: 'fedzx',
		name: 'FedZx',
		primary: '#4D148C',     // FedEx purple
		secondary: '#FF6600',   // FedEx orange
		text: '#FFFFFF',
		tagline: 'Probably overnight',
	},
]

export function carrierForBucket (bucket) {
	const idx = Math.abs(_hash(bucket * 17 + 7)) % DELIVERY_CARRIERS.length
	return DELIVERY_CARRIERS[idx]
}

function _hash (n) {
	let x = n | 0
	x = ((x ^ 61) ^ (x >>> 16)) | 0
	x = (x + (x << 3)) | 0
	x = (x ^ (x >>> 4)) | 0
	x = Math.imul(x, 0x27d4eb2d)
	x = (x ^ (x >>> 15)) | 0
	return x
}
