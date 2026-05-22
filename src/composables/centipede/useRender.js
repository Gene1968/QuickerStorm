import { globalSettings } from '@/constants/centipede/globalSettings'
import { coordinateSystem } from '@/constants/centipede/coordinateSystem'
import { sprite } from '@/constants/centipede/sprite'
import { useGraphicsEngine } from '@/composables/centipede/useGraphicsEngine'
import { useGameBoard } from '@/composables/centipede/useGameBoard'
import { useGameState } from '@/composables/centipede/useGameState'
import { useScoreMarker } from '@/composables/centipede/useScoreMarker'
import { usePlayer } from '@/composables/centipede/usePlayer'
import { useCentipede } from '@/composables/centipede/useCentipede'
import { useSpider } from '@/composables/centipede/useSpider'
import { useFlea } from '@/composables/centipede/useFlea'
import { useSnail } from '@/composables/centipede/useSnail'
import { useBullet } from '@/composables/centipede/useBullet'

let livesAnimationCount = 0

const gfx = useGraphicsEngine()
const gameBoardService = useGameBoard()
const gameStateService = useGameState()
const scoreMarkerService = useScoreMarker()
const playerService = usePlayer()
const centipedeService = useCentipede()
const spiderService = useSpider()
const fleaService = useFlea()
const snailService = useSnail()
const bulletService = useBullet()

function drawScoreBoard(animation) {
	if (animation === 0) {
		livesAnimationCount = (livesAnimationCount + 1) % 9
	}
	const animationOffset = livesAnimationCount > 4 ? 9 - livesAnimationCount : livesAnimationCount
	const { scoreBoardFont, scoreBoardTitleFontColour, scoreBoardContentFontColour } = globalSettings

	gfx.drawText(coordinateSystem.screen, globalSettings.scoreBoardLivesXPositionText, globalSettings.scoreBoardTitleYPosition, 'Lives', scoreBoardTitleFontColour, scoreBoardFont)
	gfx.drawText(coordinateSystem.screen, globalSettings.scoreBoardScoreXPosition, globalSettings.scoreBoardTitleYPosition, 'Score', scoreBoardTitleFontColour, scoreBoardFont)
	gfx.drawText(coordinateSystem.screen, globalSettings.scoreBoardLevelXPosition, globalSettings.scoreBoardTitleYPosition, 'Level', scoreBoardTitleFontColour, scoreBoardFont)
	gfx.drawText(coordinateSystem.screen, globalSettings.scoreBoardHighScoreXPosition, globalSettings.scoreBoardTitleYPosition, 'High', scoreBoardTitleFontColour, scoreBoardFont)

	gfx.drawText(coordinateSystem.screen, globalSettings.scoreBoardScoreXPosition, globalSettings.scoreBoardContentYPosition, gameStateService.score, scoreBoardContentFontColour, scoreBoardFont)
	gfx.drawText(coordinateSystem.screen, globalSettings.scoreBoardLevelXPosition, globalSettings.scoreBoardContentYPosition, gameStateService.level, scoreBoardContentFontColour, scoreBoardFont)
	gfx.drawText(coordinateSystem.screen, globalSettings.scoreBoardHighScoreXPosition, globalSettings.scoreBoardContentYPosition, gameStateService.highScore, scoreBoardContentFontColour, scoreBoardFont)

	for (let i = 0; i < gameStateService.lives; i++) {
		gfx.drawImage(
			coordinateSystem.screen,
			globalSettings.scoreBoardLivesXPositionImage + globalSettings.scoreBoardLivesOffset * i + animationOffset * 4,
			globalSettings.scoreBoardLivesYPosition,
			sprite.playerWalkRight1 + livesAnimationCount,
		)
	}
}

export function useRender() {
	return {
		draw(animation) {
			gfx.blankScreen()
			drawScoreBoard(animation)
			gameBoardService.draw()
			playerService.draw(animation)
			fleaService.draw(animation)
			spiderService.draw(animation)
			snailService.draw(animation)
			centipedeService.draw(animation)
			bulletService.draw(animation)
			scoreMarkerService.draw(animation)

			if (gameStateService.isGameOver()) {
				gfx.drawText(
					coordinateSystem.screen,
					globalSettings.gameOverXPosition,
					globalSettings.gameOverYPosition,
					'Game Over',
					globalSettings.gameOverFontColour,
					globalSettings.gameOverFont,
				)
			}
		},
	}
}
