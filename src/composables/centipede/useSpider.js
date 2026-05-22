import { globalSettings } from '@/constants/centipede/globalSettings'
import { coordinateSystem } from '@/constants/centipede/coordinateSystem'
import { sprite } from '@/constants/centipede/sprite'
import { useGraphicsEngine } from '@/composables/centipede/useGraphicsEngine'
import { useGameBoard } from '@/composables/centipede/useGameBoard'
import { usePlayer } from '@/composables/centipede/usePlayer'

let spider = null
const gfx = useGraphicsEngine()
const gameBoardService = useGameBoard()
const playerService = usePlayer()

function random(chance) {
	return Math.floor(Math.random() * chance)
}

export function useSpider() {
	return {
		checkCreateSpider() {
			if (spider) return
			if (random(globalSettings.spiderCreationChance) === 0) {
				const x = playerService.isLocatedLeftOfMiddle() ? globalSettings.gameBoardWidth - 1 : 0
				const y = (globalSettings.gameBoardHeight - globalSettings.playerAreaHeight) +
					random(globalSettings.playerAreaHeight)
				spider = {
					x, y, maxY: globalSettings.gameBoardHeight - 1,
					minY: (globalSettings.gameBoardHeight - globalSettings.playerAreaHeight) + 1,
					dy: -0.25,
				}
				spider.dx = x === 0 ? 0.25 : -0.25
				spider.startDx = spider.dx
				spider.prevX = x - 4 * spider.dx
				spider.prevY = y - 4 * spider.dy
			}
		},

		destroy() { spider = null },
		get isActive() { return spider !== null },

		checkCollision(x, y) {
			if (!spider) return false
			return !!(
				((spider.x === x || spider.x + 1 === x) && spider.y === y) ||
				((spider.prevX === x || spider.prevX + 1 === x) && spider.prevY === y)
			)
		},

		update(animation) {
			if (!spider || animation !== 0) return
			if (spider.x < -1 || spider.x >= globalSettings.gameBoardWidth) {
				spider = null
				return
			}

			let changeX = true
			if (spider.y >= spider.maxY) spider.dy = -0.25
			else if (spider.y <= spider.minY) spider.dy = 0.25
			else changeX = false

			if (changeX) spider.dx = Math.floor(Math.random() * 4) === 0 ? 0 : spider.startDx

			spider.prevY = spider.y
			spider.prevX = spider.x
			spider.x += 4 * spider.dx
			spider.y += 4 * spider.dy

			if (spider.x >= 0 && spider.x < globalSettings.gameBoardWidth) {
				gameBoardService.destroyMushroom(spider.x, spider.y)
				if (spider.x < globalSettings.gameBoardWidth - 1) {
					gameBoardService.destroyMushroom(spider.x + 1, spider.y)
				}
			}
		},

		draw(animation) {
			if (!spider) return
			const destX = spider.prevX + animation * spider.dx
			const destY = spider.prevY + animation * spider.dy
			let image = sprite.spiderAnim1Left
			if (animation % 2) image += 2
			gfx.drawImage(coordinateSystem.world, destX, destY, image)
			gfx.drawImage(coordinateSystem.world, destX + 1, destY, image + 1)
		},
	}
}
