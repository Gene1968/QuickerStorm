import { globalSettings } from '@/constants/centipede/globalSettings'
import { coordinateSystem } from '@/constants/centipede/coordinateSystem'
import { sprite } from '@/constants/centipede/sprite'
import { useGraphicsEngine } from '@/composables/centipede/useGraphicsEngine'
import { useGameBoard } from '@/composables/centipede/useGameBoard'

let snail = null
const gfx = useGraphicsEngine()
const gameBoardService = useGameBoard()

function random(chance) {
	return Math.floor(Math.random() * chance)
}

export function useSnail() {
	return {
		checkCreateSnail() {
			if (snail) return
			if (random(globalSettings.snailCreationChance) === 0) {
				snail = {
					x: 0,
					y: random(globalSettings.gameBoardHeight - globalSettings.playerAreaHeight),
					prevX: -1,
					dx: 0.25,
				}
			}
		},

		destroy() { snail = null },
		get isActive() { return snail !== null },

		checkCollision(x, y) {
			if (!snail) return false
			return !!((snail.x === x || snail.x + 1 === x) && snail.y === y)
		},

		update(animation) {
			if (!snail || animation !== 0) return
			if (snail.x >= globalSettings.gameBoardWidth) {
				snail = null
				return
			}
			snail.prevX = snail.x
			snail.x++
			if (snail.x < globalSettings.gameBoardWidth) {
				gameBoardService.poisonMushroom(snail.x, snail.y)
			}
		},

		draw(animation) {
			if (!snail) return
			const destX = snail.prevX + animation * snail.dx
			let image = sprite.snailAnim1Left
			if (animation === 1 || animation === 3) image = sprite.snailAnim2Left
			else if (animation === 2) image = sprite.snailAnim3Left
			gfx.drawImage(coordinateSystem.world, destX, snail.y, image)
			gfx.drawImage(coordinateSystem.world, destX + 1, snail.y, image + 1)
		},
	}
}
