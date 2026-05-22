import { characterDirection } from '@/constants/centipede/characterDirection'

const KeyPressEnum = { DownUnprocessed: 0, DownProcessed: 1, Up: 2 }

let keyPressList = []
let fireKeyStatus = { keyPressed: false, processed: true }

function KeyPressDetails(direction) {
	this.direction = direction
	this.keyPressType = KeyPressEnum.DownUnprocessed
}

function processKeyCode(keyCode) {
	switch (keyCode) {
	case 37: return characterDirection.left
	case 38: return characterDirection.up
	case 39: return characterDirection.right
	case 40: return characterDirection.down
	default: return characterDirection.none
	}
}

export function useKeyPress() {
	return {
		keyPress(keyCode) {
			if (keyCode === 32) {
				fireKeyStatus = { keyPressed: true, processed: false }
				return
			}
			const direction = processKeyCode(keyCode)
			if (direction === characterDirection.none) return

			for (let i = keyPressList.length - 1; i >= 0; i--) {
				if (keyPressList[i].direction === direction) {
					if (keyPressList[i].keyPressType === KeyPressEnum.Up) {
						keyPressList.push(new KeyPressDetails(direction))
					}
					return
				}
			}
			keyPressList.push(new KeyPressDetails(direction))
		},

		keyRelease(keyCode) {
			if (keyCode === 32) {
				fireKeyStatus.keyPressed = false
				return
			}
			const direction = processKeyCode(keyCode)
			if (direction === characterDirection.none) return

			for (let i = keyPressList.length - 1; i >= 0; i--) {
				if (keyPressList[i].direction === direction) {
					if (keyPressList[i].keyPressType !== KeyPressEnum.DownUnprocessed || i !== 0) {
						keyPressList.splice(i, 1)
					} else {
						keyPressList[i].keyPressType = KeyPressEnum.Up
					}
					break
				}
			}
		},

		getNextMovement() {
			let direction = characterDirection.none

			if (keyPressList.length) {
				direction = keyPressList[0].direction
				switch (keyPressList[0].keyPressType) {
				case KeyPressEnum.DownUnprocessed:
					keyPressList[0].keyPressType = KeyPressEnum.DownProcessed
					break
				case KeyPressEnum.Up:
					keyPressList.splice(0, 1)
					break
				}
			}

			const isFiring = fireKeyStatus.keyPressed || !fireKeyStatus.processed
			if (!fireKeyStatus.processed) fireKeyStatus.processed = true

			return { direction, isFiring }
		},
	}
}
