import { describe, it, expect } from 'bun:test'
import { loadBadgeView } from '@/lib/loadBadge.js'

// Pure scene-load badge view: given cullStats + region-entry flags, decide whether the badge shows,
// what single prioritized line it reads, and the full-breakdown tooltip. Priority is deepest-incomplete
// first: entering → geometry % → object (mesh/sculpt) downloads → textures → hidden. See
// docs/superpowers/specs/2026-06-19-multi-pipeline-load-badge-design.md.

const base = {
	resident: 412, known: 573, evicted: 31, pct: 100, atTarget: false, massive: false,
	effNear: 192, texPending: 0, texFailed: 0, objPending: 0, objFailed: 0,
}

describe('loadBadgeView', () => {
	it('entering with no terrain → "Entering region…"', () => {
		const v = loadBadgeView(base, true, 0)
		expect(v.show).toBe(true)
		expect(v.label).toBe('Entering region…')
	})

	it('entering with terrain patches → "Loading terrain…"', () => {
		const v = loadBadgeView(base, true, 12)
		expect(v.show).toBe(true)
		expect(v.label).toBe('Loading terrain…')
	})

	it('geometry still loading → "Nearby scene N% loaded"', () => {
		const v = loadBadgeView({ ...base, pct: 72, atTarget: false }, false, 5)
		expect(v.show).toBe(true)
		expect(v.label).toBe('Nearby scene 72% loaded')
	})

	it('geometry loading at full radius → "Overall scene N% loaded"', () => {
		const v = loadBadgeView({ ...base, pct: 72, atTarget: true }, false, 5)
		expect(v.label).toBe('Overall scene 72% loaded')
	})

	it('massive load prepends the cache warning', () => {
		const v = loadBadgeView({ ...base, pct: 72, massive: true }, false, 5)
		expect(v.label).toBe('Major new scenery to cache: Nearby scene 72% loaded')
	})

	// THE BUG (Bountiful 2026-06-19): geometry hits 100% (placeholder boxes are "resident") while mesh
	// assets still download → the badge must stay up and name the object download, not read "done".
	it('geometry 100% but object downloads pending → "Objects N downloading"', () => {
		const v = loadBadgeView({ ...base, pct: 100, objPending: 460, texPending: 0 }, false, 5)
		expect(v.show).toBe(true)
		expect(v.label).toBe('Objects 460 downloading')
	})

	it('geometry first: pct<100 wins over pending objects/textures', () => {
		const v = loadBadgeView({ ...base, pct: 72, objPending: 460, texPending: 88 }, false, 5)
		expect(v.label).toBe('Nearby scene 72% loaded')
	})

	it('objects done, textures pending → "Textures N left"', () => {
		const v = loadBadgeView({ ...base, pct: 100, objPending: 0, texPending: 88 }, false, 5)
		expect(v.show).toBe(true)
		expect(v.label).toBe('Textures 88 left')
	})

	it('objects before textures: both pending → objects wins', () => {
		const v = loadBadgeView({ ...base, pct: 100, objPending: 12, texPending: 88 }, false, 5)
		expect(v.label).toBe('Objects 12 downloading')
	})

	it('all pipelines quiescent → hidden', () => {
		const v = loadBadgeView({ ...base, pct: 100, objPending: 0, texPending: 0 }, false, 5)
		expect(v.show).toBe(false)
	})

	it('tooltip carries the full breakdown', () => {
		const v = loadBadgeView({ ...base, pct: 100, objPending: 460, texPending: 88 }, false, 5)
		expect(v.title).toContain('412')      // resident
		expect(v.title).toContain('573')      // known
		expect(v.title).toContain('192m')     // draw distance
		expect(v.title).toContain('460')      // objects pending
		expect(v.title).toContain('88')       // textures left
	})

	it('tooltip surfaces failures + the Texture-refresh hint', () => {
		const v = loadBadgeView({ ...base, pct: 100, objPending: 5, objFailed: 3, texFailed: 2 }, false, 5)
		expect(v.title).toMatch(/fail/i)
		expect(v.title).toMatch(/Texture refresh/i)
	})

	it('no failure hint when nothing failed', () => {
		const v = loadBadgeView({ ...base, pct: 72 }, false, 5)
		expect(v.title).not.toMatch(/fail/i)
	})

	// Approach A: distinguish CPU baking from network download, and warm (cache) from cold rebuilds.
	it('warm region, geometry loading → "Rebuilding from cache — N%"', () => {
		const v = loadBadgeView({ ...base, pct: 60, warm: true }, false, 5)
		expect(v.label).toBe('Rebuilding from cache — 60%')
	})

	it('cold region, geometry loading → unchanged "Nearby scene N% loaded"', () => {
		const v = loadBadgeView({ ...base, pct: 60, warm: false }, false, 5)
		expect(v.label).toBe('Nearby scene 60% loaded')
	})

	it('pct 100, build backlog, no network → "Building scene — N objects" (cold)', () => {
		const v = loadBadgeView({ ...base, pct: 100, buildPending: 320, netInflight: 0, objPending: 0 }, false, 5)
		expect(v.label).toBe('Building scene — 320 objects')
	})

	it('pct 100, build backlog, no network, warm → "Rebuilding from cache — N objects"', () => {
		const v = loadBadgeView({ ...base, pct: 100, buildPending: 320, netInflight: 0, warm: true }, false, 5)
		expect(v.label).toBe('Rebuilding from cache — 320 objects')
	})

	it('network fetches in flight → still "Objects N downloading"', () => {
		const v = loadBadgeView({ ...base, pct: 100, buildPending: 50, netInflight: 12, objPending: 460 }, false, 5)
		expect(v.label).toBe('Objects 460 downloading')
	})

	it('build backlog alone keeps the badge shown', () => {
		const v = loadBadgeView({ ...base, pct: 100, buildPending: 5, objPending: 0, texPending: 0 }, false, 5)
		expect(v.show).toBe(true)
	})
})
