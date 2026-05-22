import { globalSettings } from '@/constants/centipede/globalSettings'
import { characterDirection } from '@/constants/centipede/characterDirection'
import { gameState } from '@/constants/centipede/gameState'
import { useGameState } from '@/composables/centipede/useGameState'
import { useGameBoard } from '@/composables/centipede/useGameBoard'
import { usePlayer } from '@/composables/centipede/usePlayer'
import { useCentipede } from '@/composables/centipede/useCentipede'
import { useSpider } from '@/composables/centipede/useSpider'
import { useFlea } from '@/composables/centipede/useFlea'
import { useSnail } from '@/composables/centipede/useSnail'
import { useBullet } from '@/composables/centipede/useBullet'
import { useScoreMarker } from '@/composables/centipede/useScoreMarker'
import { useKeyPress } from '@/composables/centipede/useKeyPress'

const gameStateService = useGameState()
const gameBoardService = useGameBoard()
const playerService = usePlayer()
const centipedeService = useCentipede()
const spiderService = useSpider()
const fleaService = useFlea()
const snailService = useSnail()
const bulletService = useBullet()
const scoreMarkerService = useScoreMarker()
const keyPressHandler = useKeyPress()

function resetBoard() {
	snailService.destroy()
	fleaService.destroy()
	spiderService.destroy()
	centipedeService.destroy()
	gameBoardService.initialise()
}

function initialiseLevel() {
	centipedeService.create(
		Math.floor(globalSettings.gameBoardWidth / 2),
		0,
		globalSettings.centipedeMinimumLength + gameStateService.currentLevel(),
		globalSettings.centipedeFramesPerMoveNormalSpeed,
		characterDirection.down,
		characterDirection.right,
		false,
	)
	for (let i = 1; i < gameStateService.currentLevel() && i < globalSettings.maxCentipedes; i++) {
		centipedeService.create(
			i * 2 - 1, 1, 0,
			gameStateService.isCurrentLevelHighSpeed()
				? globalSettings.centipedeFramesPerMoveHighSpeed
				: globalSettings.centipedeFramesPerMoveNormalSpeed,
			characterDirection.down, characterDirection.right, false,
		)
	}
}

function movePlayer(animation) {
	playerService.update(animation)
	if (animation % 2 === 0 && playerService.isAlive() && playerService.isFiring()) {
		const pos = playerService.getPreviousPosition()
		bulletService.createNewBullet(pos.x, pos.y - 1)
	}
}

function checkGenerateNewCentipede() {
	if (centipedeService.isFirstCentipedeAtEndOfScreen() && !centipedeService.isCentipedeAtPlayerTopBoundary()) {
		centipedeService.create(
			-1,
			(globalSettings.gameBoardHeight - globalSettings.playerAreaHeight) + 1,
			0,
			globalSettings.centipedeFramesPerMoveHighSpeed,
			characterDirection.down, characterDirection.right, false,
		)
	}
}

function checkPlayerCollision() {
	if (!playerService.isAlive()) return
	const pos = playerService.getPosition()
	if (spiderService.checkCollision(pos.x, pos.y) ||
			fleaService.checkCollision(pos.x, pos.y) ||
			centipedeService.checkCollision(pos.x, pos.y, false)) {
		playerService.die()
		gameStateService.die()
	}
}

function moveCharacters(animation) {
	bulletService.update(animation)
	fleaService.update(animation)
	spiderService.update(animation)
	snailService.update(animation)
	centipedeService.update(animation)
	movePlayer(animation)
	scoreMarkerService.update(animation)

	if (animation === 0) {
		fleaService.checkCreateFlea()
		spiderService.checkCreateSpider()
		snailService.checkCreateSnail()
		checkGenerateNewCentipede()
	}
	checkPlayerCollision()
}

function resetAfterPlayerRegeneration() {
	if (gameStateService.isGameOver()) gameStateService.reset()
	resetBoard()
	playerService.regenerate(true)
	gameStateService.playerRegenerate()
	initialiseLevel()
}

function levelTransitionUpdate() {
	if (gameStateService.hasLevelTransitionResetAllLines()) {
		initialiseLevel()
		gameStateService.completeLevelTransition()
	}
}

function activeGameUpdate(animation) {
	if (!centipedeService.anyAlive()) {
		gameStateService.startLevelTransition()
		playerService.regenerate(false)
		bulletService.destroy()
		spiderService.destroy()
		fleaService.destroy()
		snailService.destroy()
	} else {
		moveCharacters(animation)
	}
}

function playerDeathTransitionUpdate(animation) {
	const keyPress = keyPressHandler.getNextMovement()
	if (gameStateService.hasPlayerDeathTransitionComplete() && keyPress.isFiring) {
		resetAfterPlayerRegeneration()
	} else {
		moveCharacters(animation)
	}
}

function gameOverTransitionUpdate(animation) {
	const keyPress = keyPressHandler.getNextMovement()
	if (gameStateService.hasGameOverTransitionComplete() && keyPress.isFiring) {
		resetAfterPlayerRegeneration()
	} else {
		moveCharacters(animation)
	}
}

export function useGame() {
	return {
		initialise() {
			gameStateService.startTimer()
			resetBoard()
			playerService.createPlayer()
			initialiseLevel()
		},

		restart() {
			gameStateService.reset()
			resetBoard()
			playerService.regenerate(true)
			gameStateService.playerRegenerate()
			initialiseLevel()
		},

		update(animation) {
			switch (gameStateService.gameState) {
			case gameState.gameActive:					 activeGameUpdate(animation); break
			case gameState.playerDeathTransition: playerDeathTransitionUpdate(animation); break
			case gameState.levelTransition:			levelTransitionUpdate(); break
			case gameState.gameOver:						 gameOverTransitionUpdate(animation); break
			}
		},
	}
}
