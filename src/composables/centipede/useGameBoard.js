import { globalSettings } from '@/constants/centipede/globalSettings'
import { boardLocation } from '@/constants/centipede/boardLocation'
import { characterDirection } from '@/constants/centipede/characterDirection'
import { coordinateSystem } from '@/constants/centipede/coordinateSystem'
import { sprite } from '@/constants/centipede/sprite'
import { useGraphicsEngine } from '@/composables/centipede/useGraphicsEngine'
import { useGameState } from '@/composables/centipede/useGameState'

let map = []
let mushroomsInPlayerArea = 0
let mushroomsOnScreen = 0

const gfx = useGraphicsEngine()
const gameStateService = useGameState()

function random(chance) {
	return Math.floor(Math.random() * chance)
}

function inPlayerArea(row) {
	return row > globalSettings.gameBoardHeight - globalSettings.playerAreaHeight
}

function calculateImageType(yPosition, mushroomStrength) {
	let mushroomImage = 0
	switch (mushroomStrength) {
	case 4: mushroomImage = sprite.mushroomRed100; break
	case 3: mushroomImage = sprite.mushroomRed75; break
	case 2: mushroomImage = sprite.mushroomRed50; break
	case 1: mushroomImage = sprite.mushroomRed25; break
	case -4: mushroomImage = sprite.mushroomGreen100; break
	case -3: mushroomImage = sprite.mushroomGreen75; break
	case -2: mushroomImage = sprite.mushroomGreen50; break
	case -1: mushroomImage = sprite.mushroomGreen25; break
	}
	let isHighSpeed = gameStateService.isCurrentLevelHighSpeed()
	if (gameStateService.isCurrentlyInLevelTransition() && yPosition > gameStateService.levelTransitionCount()) {
		isHighSpeed = !isHighSpeed
	}
	if (isHighSpeed) mushroomImage += 8
	return mushroomImage
}

export function useGameBoard() {
	return {
		get mushroomsInPlayerArea() { return mushroomsInPlayerArea },
		get mushroomsOnScreen() { return mushroomsOnScreen },
		get clearedRowCount() {
			let count = 0
			for (let h = globalSettings.gameBoardHeight - 2; h >= 0; h--) {
				let empty = true
				for (let w = 0; w < globalSettings.gameBoardWidth; w++) {
					if (map[h][w] !== 0) { empty = false; break }
				}
				if (!empty) break
				count++
			}
			return count
		},
		get totalMushroomHealth() {
			let total = 0
			for (let h = 0; h < globalSettings.gameBoardHeight; h++) {
				for (let w = 0; w < globalSettings.gameBoardWidth; w++) {
					total += Math.abs(map[h][w])
				}
			}
			return total / 4
		},
		get totalPoisonMushroomHealth() {
			let total = 0
			for (let h = 0; h < globalSettings.gameBoardHeight; h++) {
				for (let w = 0; w < globalSettings.gameBoardWidth; w++) {
					if (map[h][w] < 0) total += -map[h][w]
				}
			}
			return total / 4
		},

		initialise() {
			map = []
			mushroomsInPlayerArea = 0
			mushroomsOnScreen = 0
			this.generateMushrooms()
		},

		generateMushrooms() {
			for (let h = 0; h < globalSettings.gameBoardHeight; h++) {
				map.push([])
				for (let w = 0; w < globalSettings.gameBoardWidth; w++) {
					map[h].push(0)
					if (h < globalSettings.gameBoardHeight - 1) {
						const chance = inPlayerArea(h)
							? globalSettings.mushroomChancePlayerArea
							: globalSettings.mushroomChanceNonPlayerArea
						if (random(chance) === 0) this.createMushroom(w, h)
					}
				}
			}
		},

		createMushroom(x, y) {
			if (!map[y][x]) this.incrementMushroomCount(y)
			map[y][x] = 4
		},

		poisonMushroom(x, y) {
			if (map[y][x] > 0) map[y][x] *= -1
		},

		destroyMushroom(x, y) {
			if (this.checkCollision(x, y, false) !== boardLocation.space) {
				this.decrementMushroomCount(y)
				map[y][x] = boardLocation.space
			}
		},

		incrementMushroomCount(y) {
			if (inPlayerArea(y)) mushroomsInPlayerArea++
			mushroomsOnScreen++
		},

		decrementMushroomCount(y) {
			if (inPlayerArea(y)) mushroomsInPlayerArea--
			mushroomsOnScreen--
		},

		playerAllowedToMove(currentX, currentY, direction) {
			let x = currentX
			let y = currentY
			switch (direction) {
			case characterDirection.down: y += 1; break
			case characterDirection.up: y -= 1; break
			case characterDirection.right: x += 1; break
			case characterDirection.left: x -= 1; break
			}
			if (x >= globalSettings.gameBoardWidth || x < 0 ||
					y >= globalSettings.gameBoardHeight || y < 0 ||
					!inPlayerArea(y)) {
				return false
			}
			return map[y][x] === 0
		},

		checkCollision(x, y, destroyLocation) {
			const mushroomSpace = map[y][x]
			if (destroyLocation) {
				if (map[y][x] < 0) map[y][x]++
				else if (map[y][x] > 0) map[y][x]--
				if (mushroomSpace !== 0 && map[y][x] === 0) this.decrementMushroomCount(y)
			}
			if (mushroomSpace > 0) return boardLocation.mushroom
			if (mushroomSpace < 0) return boardLocation.poisonMushroom
			return boardLocation.space
		},

		draw() {
			let incrementLevelTransitionCount = false
			if (gameStateService.isCurrentlyInLevelTransition()) {
				incrementLevelTransitionCount = true
				const ltCount = gameStateService.levelTransitionCount()
				for (let w = 0; w < globalSettings.gameBoardWidth; w++) {
					if (map[ltCount][w] < 0) map[ltCount][w] = -4
					else if (map[ltCount][w] > 0) map[ltCount][w] = 4
				}
			}
			for (let h = 0; h < globalSettings.gameBoardHeight; h++) {
				for (let w = 0; w < globalSettings.gameBoardWidth; w++) {
					const strength = map[h][w]
					if (strength) gfx.drawImage(coordinateSystem.world, w, h, calculateImageType(h, strength))
				}
			}
			if (incrementLevelTransitionCount) gameStateService.incrementLevelTransitionLineCount()
		},
	}
}
