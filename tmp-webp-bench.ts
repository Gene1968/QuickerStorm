// Throwaway bench: is the new J2C→WebP transcode path slow enough to explain ~2 textures/min?
// Run: bun tmp-webp-bench.ts   (delete after use)
import { readFileSync } from 'node:fs'
import { decodeJ2C, encodeWebp, j2cToImageWithAlpha } from './server/lib/j2c'
import { decodeInPool } from './server/lib/j2cPool'

const fix = (n: string) => readFileSync(`server/__tests__/fixtures/${n}`)
const terrain = fix('terrain-dirt.j2c')
const palm = fix('palm-frond-rgba.j2c')

async function timeIt(label: string, fn: () => Promise<unknown> | unknown, n = 5) {
	// warm once
	await fn()
	const t0 = performance.now()
	for (let i = 0; i < n; i++) await fn()
	const ms = (performance.now() - t0) / n
	console.log(`${label}: ${ms.toFixed(1)}ms avg (n=${n})`)
	return ms
}

// init magick in-process
await decodeJ2C(terrain)

// raw encode cost at realistic max client-relevant size: 512x512
const px512 = new Uint8Array(512 * 512 * 4)
for (let i = 0; i < px512.length; i++) px512[i] = (i * 2654435761) & 0xff // noisy = worst case
await timeIt('encodeWebp 512x512 RGBA LOSSY q90', () => encodeWebp(px512, 512, 512, 4, false), 3)
await timeIt('encodeWebp 512x512 RGBA LOSSLESS+exact e75', () => encodeWebp(px512, 512, 512, 4, true), 3)

// full pipeline, in-process
await timeIt('j2cToImageWithAlpha terrain (opaque 128px)', () => j2cToImageWithAlpha(terrain), 5)
await timeIt('j2cToImageWithAlpha palm (RGBA alpha)', () => j2cToImageWithAlpha(palm), 5)

// the REAL server path: worker pool (spawns workers like the live server)
const t0 = performance.now()
const burst = await Promise.all(
	Array.from({ length: 12 }, (_, i) => decodeInPool(i % 2 ? palm : terrain).catch(e => ({ err: String(e) }))),
)
const burstMs = performance.now() - t0
const errs = burst.filter((r: any) => r.err)
console.log(`pool burst of 12 (6 terrain + 6 palm): ${burstMs.toFixed(0)}ms total, errors: ${errs.length}`)
if (errs.length) console.log('first error:', (errs[0] as any).err)
const sizes = burst.filter((r: any) => !r.err).map((r: any) => `${r.image.length}B a=${r.hasAlpha}`)
console.log('sizes:', sizes.slice(0, 4).join(', '))
process.exit(0)
