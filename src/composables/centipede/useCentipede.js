import { globalSettings } from '@/constants/centipede/globalSettings'
import { characterDirection } from '@/constants/centipede/characterDirection'
import { characterState } from '@/constants/centipede/characterState'
import { boardLocation } from '@/constants/centipede/boardLocation'
import { coordinateSystem } from '@/constants/centipede/coordinateSystem'
import { sprite } from '@/constants/centipede/sprite'
import { useGraphicsEngine } from '@/composables/centipede/useGraphicsEngine'
import { useGameBoard } from '@/composables/centipede/useGameBoard'

let centipedes = []
const gfx = useGraphicsEngine()
const gameBoardService = useGameBoard()

const upBoundary = (globalSettings.gameBoardHeight - globalSettings.playerAreaHeight) + 1
const downBoundary = globalSettings.gameBoardHeight - 1
const leftBoundary = 0
const rightBoundary = globalSettings.gameBoardWidth - 1

function setPositionFromDirection(c) {
	c.prevX = c.x
	c.prevY = c.y
	switch (c.currentDirection) {
	case characterDirection.down:	c.y++; break
	case characterDirection.up:		c.y--; break
	case characterDirection.right: c.x++; break
	case characterDirection.left:	c.x--; break
	}
}

function setSpeed(c) {
	c.dx = (c.x - c.prevX) / c.framesPerMove
	c.dy = (c.y - c.prevY) / c.framesPerMove
}

function setDirectionVertical(c) {
	if (c.previousDirection === characterDirection.down && c.y >= downBoundary) {
		c.currentDirection = characterDirection.up
	} else if (c.previousDirection === characterDirection.up && c.y <= upBoundary) {
		c.currentDirection = characterDirection.down
	} else {
		c.currentDirection = c.previousDirection
	}
}

function moveCentipede(c, animation) {
	if ((animation + 1) % c.framesPerMove !== 0) return

	const collisionType = gameBoardService.checkCollision(c.x, c.y, false)

	if (c.fallingStraightDown || collisionType === boardLocation.poisonMushroom) {
		c.fallingStraightDown = c.y !== downBoundary
		c.currentDirection = characterDirection.down
	}

	if (!c.fallingStraightDown) {
		if (c.currentDirection === characterDirection.right) {
			if (c.x >= rightBoundary || collisionType === boardLocation.mushroom) {
				setDirectionVertical(c)
				c.previousDirection = characterDirection.right
			}
		} else if (c.currentDirection === characterDirection.left) {
			if (c.x <= leftBoundary || collisionType === boardLocation.mushroom) {
				setDirectionVertical(c)
				c.previousDirection = characterDirection.left
			}
		} else {
			const nowDirection = c.currentDirection
			c.currentDirection = c.previousDirection === characterDirection.right
				? characterDirection.left
				: characterDirection.right
			c.previousDirection = nowDirection

			if (c.currentDirection === characterDirection.right && c.x >= rightBoundary) {
				c.currentDirection = characterDirection.left
			} else if (c.currentDirection === characterDirection.left && c.x <= leftBoundary) {
				c.currentDirection = characterDirection.right
			}
		}
	}

	setPositionFromDirection(c)

	let prevBodyX = c.prevX
	let prevBodyY = c.prevY
	for (const body of c.body) {
		body.prevX = body.x
		body.prevY = body.y
		body.x = prevBodyX
		body.y = prevBodyY
		setSpeed(body)
		prevBodyX = body.prevX
		prevBodyY = body.prevY
	}
	setSpeed(c)
}

function createCentipede(x, y, bodyLength, framesPerMove, previousDirection, currentDirection, fallingStraightDown) {
	const c = {
		x, y, previousDirection, currentDirection, fallingStraightDown, framesPerMove,
		characterState: characterState.active,
		body: [],
	}
	setPositionFromDirection(c)

	let xBody = c.x
	let yBody = c.y
	const yDiff = c.y - c.prevY
	const xDiff = c.x - c.prevX

	for (let i = 0; i < bodyLength; i++) {
		xBody -= xDiff
		yBody -= yDiff
		const body = {
			prevX: xBody, prevY: c.y,
			x: xBody - xDiff, y: yBody - yDiff,
			framesPerMove,
		}
		setSpeed(body)
		c.body.push(body)
	}

	centipedes.push(c)
	return c
}

export function useCentipede() {
	return {
		create(x, y, bodyLength, framesPerMove, previousDirection, currentDirection, fallingStraightDown) {
			createCentipede(x, y, bodyLength, framesPerMove, previousDirection, currentDirection, fallingStraightDown)
		},

		destroy() { centipedes = [] },
		anyAlive() { return centipedes.length > 0 },
		get segmentCount() {
			return centipedes.reduce((sum, c) => sum + 1 + c.body.length, 0)
		},
		get fastSegmentCount() {
			return centipedes.reduce((sum, c) =>
				c.framesPerMove === globalSettings.centipedeFramesPerMoveHighSpeed ? sum + 1 + c.body.length : sum, 0)
		},

		isFirstCentipedeAtEndOfScreen() {
			if (!centipedes.length) return false
			const first = centipedes[0]
			return first.y === globalSettings.gameBoardHeight - 1 &&
				(first.x === globalSettings.gameBoardWidth - 1 || first.x === 0)
		},

		isCentipedeAtPlayerTopBoundary() {
			return centipedes.some(c => c.x === 0 && c.y === upBoundary)
		},

		update(animation) {
			centipedes = centipedes.filter(c => c.characterState === characterState.active)
			for (const c of centipedes) moveCentipede(c, animation)
		},

		checkCollision(x, y, causeSplit) {
			for (const c of centipedes) {
				if (!causeSplit) {
					if (c.x === x && c.y === y) return true
					if (c.body.some(seg => seg.x === x && seg.y === y)) return true
				} else {
					if (c.x === x && c.y === y) {
						if (c.body.length === 0) {
							c.characterState = characterState.dead
						} else {
							c.x = c.body[0].x
							c.y = c.body[0].y
							c.body.splice(0, 1)
						}
						return true
					}
					if (c.body.length > 0) {
						const lastIdx = c.body.length - 1
						if (c.body[lastIdx].x === x && c.body[lastIdx].y === y) {
							c.body.pop()
							return true
						}
						for (let i = 0; i < c.body.length - 1; i++) {
							if (c.body[i].x === x && c.body[i].y === y) {
								const newC = createCentipede(
									c.body[i + 1].x, c.body[i + 1].y, 0, c.framesPerMove,
									(c.currentDirection === characterDirection.down || c.currentDirection === characterDirection.up)
										? c.previousDirection : c.currentDirection,
									characterDirection.down, c.fallingStraightDown,
								)
								if (i < c.body.length - 2) {
									newC.body = c.body.splice(i + 2, c.body.length - (i + 2))
								}
								c.body.pop()
								return true
							}
						}
					}
				}
			}
			return false
		},

		draw(animation) {
			for (const c of centipedes) {
				if (c.characterState === characterState.dead) continue

				const destX = c.prevX + ((animation + 1) % c.framesPerMove) * c.dx
				const destY = c.prevY + ((animation + 1) % c.framesPerMove) * c.dy

				let image = sprite.centipedeHeadDown
				if (c.dx > 0) image = sprite.centipedeHeadRight
				else if (c.dx < 0) image = sprite.centipedeHeadLeft
				else if (c.dy < 0) image = sprite.centipedeHeadUp

				gfx.drawImage(coordinateSystem.world, destX, destY, image)

				for (const body of c.body) {
					const bx = body.prevX + ((animation + 1) % body.framesPerMove) * body.dx
					const by = body.prevY + ((animation + 1) % body.framesPerMove) * body.dy

					let bodyImage = sprite.centipedeBodyVertical1
					if (body.dx > 0) bodyImage = sprite.centipedeBodyRight1
					else if (body.dx < 0) bodyImage = sprite.centipedeBodyLeft1
					bodyImage += animation

					gfx.drawImage(coordinateSystem.world, bx, by, bodyImage)
				}
			}
		},
	}
}
