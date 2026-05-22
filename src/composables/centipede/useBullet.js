import { globalSettings } from '@/constants/centipede/globalSettings'
import { characterState } from '@/constants/centipede/characterState'
import { boardLocation } from '@/constants/centipede/boardLocation'
import { coordinateSystem } from '@/constants/centipede/coordinateSystem'
import { sprite } from '@/constants/centipede/sprite'
import { useGraphicsEngine } from '@/composables/centipede/useGraphicsEngine'
import { useGameBoard } from '@/composables/centipede/useGameBoard'
import { useGameState } from '@/composables/centipede/useGameState'
import { useScoreMarker } from '@/composables/centipede/useScoreMarker'
import { useFlea } from '@/composables/centipede/useFlea'
import { useSpider } from '@/composables/centipede/useSpider'
import { useSnail } from '@/composables/centipede/useSnail'
import { useCentipede } from '@/composables/centipede/useCentipede'

let bullets = []
const gfx = useGraphicsEngine()
const gameBoardService = useGameBoard()
const gameStateService = useGameState()
const scoreMarkerService = useScoreMarker()
const fleaService = useFlea()
const spiderService = useSpider()
const snailService = useSnail()
const centipedeService = useCentipede()

function checkCollision(x, y) {
	let collisionScore = 0

	const mushroomHit = gameBoardService.checkCollision(x, y, true)
	if (mushroomHit === boardLocation.mushroom) collisionScore = globalSettings.scoreHitMushroom
	else if (mushroomHit === boardLocation.poisonMushroom) collisionScore = globalSettings.scoreHitPoisonMushroom

	if (!collisionScore && fleaService.checkCollision(x, y)) {
		fleaService.destroy()
		collisionScore = globalSettings.scoreHitFlea
	}
	if (!collisionScore && spiderService.checkCollision(x, y)) {
		spiderService.destroy()
		collisionScore = globalSettings.scoreHitSpider
	}
	if (!collisionScore && snailService.checkCollision(x, y)) {
		snailService.destroy()
		collisionScore = globalSettings.scoreHitSnail
	}
	if (!collisionScore && centipedeService.checkCollision(x, y, true)) {
		gameBoardService.createMushroom(x, y)
		collisionScore = globalSettings.scoreHitCentipede
	}

	if (collisionScore) {
		gameStateService.incrementScore(collisionScore)
		scoreMarkerService.create(x, y, collisionScore)
	}

	return collisionScore > 0
}

function moveBullet(bullet) {
	if (bullet.bulletState === characterState.active) bullet.y--
	if (bullet.y < 0 || (bullet.bulletState === characterState.active && checkCollision(bullet.x, bullet.y))) {
		bullet.bulletState = characterState.dead
	}
	if (bullet.bulletState === characterState.dead) bullet.animationDeadCount++
}

function isAlive(bullet) {
	if (bullet.y < 0) return false
	return !(bullet.bulletState === characterState.dead &&
		bullet.animationDeadCount > globalSettings.delayAfterDeathBeforeBulletDispose)
}

export function useBullet() {
	return {
		createNewBullet(x, y) {
			if (bullets.length >= globalSettings.maxBulletsOnScreen) return
			const bullet = { x, y, bulletState: characterState.active, animationDeadCount: 0 }
			if (checkCollision(x, y)) bullet.bulletState = characterState.dead
			bullets.push(bullet)
		},

		destroy() { bullets = [] },

		update() {
			const alive = []
			for (const bullet of bullets) {
				moveBullet(bullet)
				if (isAlive(bullet)) alive.push(bullet)
			}
			bullets = alive
		},

		draw() {
			for (const bullet of bullets) {
				gfx.drawImage(
					coordinateSystem.world, bullet.x, bullet.y,
					bullet.bulletState === characterState.active ? sprite.bullet : sprite.explosion,
				)
			}
		},
	}
}
