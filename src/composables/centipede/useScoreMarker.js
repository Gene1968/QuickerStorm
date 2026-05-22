import { globalSettings } from '@/constants/centipede/globalSettings'
import { characterState } from '@/constants/centipede/characterState'
import { coordinateSystem } from '@/constants/centipede/coordinateSystem'
import { useGraphicsEngine } from '@/composables/centipede/useGraphicsEngine'

let scoreMarkers = []
const gfx = useGraphicsEngine()

function moveScoreMarker(sm) {
	sm.y += sm.dy
	if (sm.y - sm.stopY < 0.75) {
		sm.colour = sm.y - sm.stopY < 0.5 ? 'darkgoldenrod' : 'goldenrod'
	}
	if (sm.y === sm.stopY) sm.characterState = characterState.dead
}

export function useScoreMarker() {
	return {
		create(x, y, score) {
			scoreMarkers.push({
				score, x, y,
				dy: -0.125,
				stopY: y - 1,
				characterState: characterState.active,
				colour: 'gold',
			})
		},

		destroy() { scoreMarkers = [] },

		update() {
			const alive = []
			for (const sm of scoreMarkers) {
				moveScoreMarker(sm)
				if (sm.characterState !== characterState.dead) alive.push(sm)
			}
			scoreMarkers = alive
		},

		draw() {
			for (const sm of scoreMarkers) {
				gfx.drawText(coordinateSystem.world, sm.x, sm.y, sm.score, sm.colour, globalSettings.scoreMarkerFont)
			}
		},
	}
}
