import { globalSettings } from '@/constants/centipede/globalSettings'
import { gameState } from '@/constants/centipede/gameState'

const LS_HIGH_SCORE = 'centipede-high-score'

let score = 0
let highScore = parseInt(localStorage.getItem(LS_HIGH_SCORE) ?? '0', 10)
let level = 1
let lives = globalSettings.lives
let currentGameState = gameState.gameActive
let levelTransitionLineCount = 0
let playerDieTime = null
let gameStartTime = Date.now()
let gameEndTime = null

export function useGameState() {
	return {
		get score() { return score },
		get highScore() { return highScore },
		get level() { return level },
		get lives() { return lives },
		get elapsedMs() { return (gameEndTime ?? Date.now()) - gameStartTime },
		get gameState() { return currentGameState },

		currentLevel() { return level },

		hasGameOverTransitionComplete() {
			return new Date() - playerDieTime > globalSettings.delayAfterDeathBeforeNewGameStart
		},

		hasPlayerDeathTransitionComplete() {
			return new Date() - playerDieTime > globalSettings.delayAfterDeathBeforePlayerRegeneration
		},

		isGameOver() { return currentGameState === gameState.gameOver },
		isCurrentlyInLevelTransition() { return currentGameState === gameState.levelTransition },

		hasLevelTransitionResetAllLines() {
			return currentGameState === gameState.levelTransition &&
				levelTransitionLineCount >= globalSettings.gameBoardHeight
		},

		isCurrentLevelHighSpeed() { return level % 2 === 0 },
		levelTransitionCount() { return levelTransitionLineCount },
		incrementLevelTransitionLineCount() { levelTransitionLineCount++ },

		startLevelTransition() {
			currentGameState = gameState.levelTransition
			levelTransitionLineCount = 0
			level++
		},

		completeLevelTransition() {
			currentGameState = gameState.gameActive
			levelTransitionLineCount = 0
		},

		reset() {
			lives = globalSettings.lives
			level = 1
			score = 0
			currentGameState = gameState.gameActive
			gameStartTime = Date.now()
			gameEndTime = null
		},

		incrementScore(increment) {
			score += increment
			if (score > highScore) {
				highScore = score
				localStorage.setItem(LS_HIGH_SCORE, highScore)
			}
		},

		die() {
			if (lives > 0) lives--
			currentGameState = lives === 0 ? gameState.gameOver : gameState.playerDeathTransition
			if (lives === 0) gameEndTime = Date.now()
			playerDieTime = new Date()
		},

		playerRegenerate() { currentGameState = gameState.gameActive },

		startTimer() { gameStartTime = Date.now() },
	}
}
