import { globalSettings } from '@/constants/centipede/globalSettings'
import { characterDirection } from '@/constants/centipede/characterDirection'
import { characterState } from '@/constants/centipede/characterState'
import { coordinateSystem } from '@/constants/centipede/coordinateSystem'
import { sprite } from '@/constants/centipede/sprite'
import { useGraphicsEngine } from '@/composables/centipede/useGraphicsEngine'
import { useGameBoard } from '@/composables/centipede/useGameBoard'
import { useKeyPress } from '@/composables/centipede/useKeyPress'

let player = null
const gfx = useGraphicsEngine()
const gameBoardService = useGameBoard()
const keyPressHandler = useKeyPress()

function setStartPosition() {
	player.x = Math.floor(globalSettings.gameBoardWidth / 2)
	player.y = globalSettings.gameBoardHeight - 1
}

export function usePlayer() {
	return {
		createPlayer() {
			player = {
				dx: 0, dy: 0,
				direction: characterDirection.none,
				isFiring: false,
				playerState: characterState.active,
			}
			setStartPosition()
			player.prevX = player.x
			player.prevY = player.y
		},

		isLocatedLeftOfMiddle() {
			return player && player.x < globalSettings.gameBoardWidth / 2
		},

		die() { player.playerState = characterState.dead },
		isAlive() { return player.playerState === characterState.active },
		isFiring() { return player && player.isFiring },

		regenerate(resetToStartPosition) {
			if (resetToStartPosition) setStartPosition()
			player.playerState = characterState.active
			player.prevX = player.x
			player.prevY = player.y
			player.dx = 0
			player.dy = 0
			player.direction = characterDirection.none
		},

		getPreviousPosition() { return { x: player.prevX, y: player.prevY } },
		getPosition() { return { x: player.x, y: player.y } },

		update(animation) {
			if (!player || player.playerState !== characterState.active) return
			if (animation % 2 !== 0) return

			const playerMove = keyPressHandler.getNextMovement()
			if (playerMove.direction !== characterDirection.none &&
					!gameBoardService.playerAllowedToMove(player.x, player.y, playerMove.direction)) {
				playerMove.direction = characterDirection.none
			}

			player.prevX = player.x
			player.prevY = player.y
			player.direction = playerMove.direction
			player.isFiring = playerMove.isFiring

			switch (playerMove.direction) {
			case characterDirection.none:	player.dx = 0;		player.dy = 0;		break
			case characterDirection.left:	player.x -= 1;	 player.dx = -0.5; player.dy = 0;	 break
			case characterDirection.right: player.x += 1;	 player.dx = 0.5;	player.dy = 0;	 break
			case characterDirection.up:		player.y -= 1;	 player.dx = 0;		player.dy = -0.5; break
			case characterDirection.down:	player.y += 1;	 player.dx = 0;		player.dy = 0.5;	break
			}
		},

		draw(animation) {
			if (!player) return
			let image, destX, destY

			if (player.playerState !== characterState.active) {
				image = sprite.explosion
				destX = player.x
				destY = player.y
			} else {
				image = sprite.playerStandStill
				destX = player.prevX + (animation % 2) * player.dx
				destY = player.prevY + (animation % 2) * player.dy

				switch (player.direction) {
				case characterDirection.right: image = sprite.playerWalkRight1 + animation; break
				case characterDirection.left:	image = sprite.playerWalkLeft1 + animation;	break
				case characterDirection.none:
					if (player.isFiring) image = sprite.playerFire
					break
				}
			}

			gfx.drawImage(coordinateSystem.world, destX, destY, image)
		},
	}
}
