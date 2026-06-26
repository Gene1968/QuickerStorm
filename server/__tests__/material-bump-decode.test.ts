import { describe, it, expect } from 'bun:test'
import { bumpFromTEByte, mcodeFromMaterialByte } from '../lib/lludp-codec'

// The TE "bump" byte (field 8) packs three fields: bits 0-4 = bumpmap type, bit 5 = fullbright,
// bits 6-7 = shininess. bumpFromTEByte extracts just the 5-bit bumpmap type (the value the
// Texture tab's "Bumpiness" row shows). Shiny/fullbright are read separately and must not leak in.
describe('bumpFromTEByte', () => {
	it('extracts the low 5 bits (bumpmap type)', () => {
		expect(bumpFromTEByte(0x00)).toBe(0)   // None
		expect(bumpFromTEByte(0x03)).toBe(3)   // Woodgrain
		expect(bumpFromTEByte(0x11)).toBe(17)  // Weave (highest defined type)
	})
	it('ignores the fullbright (bit 5) and shiny (bits 6-7) bits', () => {
		expect(bumpFromTEByte(0x20)).toBe(0)   // fullbright only → still None
		expect(bumpFromTEByte(0xC0)).toBe(0)   // shiny High only → still None
		expect(bumpFromTEByte(0xE3)).toBe(3)   // shiny+fullbright+Woodgrain → 3
	})
})

// The ObjectData material byte carries the prim material code (mcode) in its low 4 bits
// (LL_MCODE_MASK 0x0f): 0 Stone, 1 Metal, 2 Glass, 3 Wood, 4 Flesh, 5 Plastic, 6 Rubber, 7 Light.
describe('mcodeFromMaterialByte', () => {
	it('extracts the low 4 bits (material code)', () => {
		expect(mcodeFromMaterialByte(0)).toBe(0)   // Stone
		expect(mcodeFromMaterialByte(3)).toBe(3)   // Wood
		expect(mcodeFromMaterialByte(7)).toBe(7)   // Light
	})
	it('masks off high bits (LL_MCODE_MASK 0x0f)', () => {
		expect(mcodeFromMaterialByte(0xF3)).toBe(3)
	})
})
