const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

export function formatBytes(bytes) {
	if (bytes <= 0) return '0 B'
	const i = Math.min(Math.floor(Math.log2(bytes) / 10), UNITS.length - 1)
	if (i === 0) return `${bytes} B`
	return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + UNITS[i]
}
