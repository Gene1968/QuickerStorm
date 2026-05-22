import { globalSettings } from '@/constants/centipede/globalSettings'
import { coordinateSystem } from '@/constants/centipede/coordinateSystem'

let canvas = null
let spriteSheet = null

function toPixelX(x) {
	return x * globalSettings.spriteSize
}

function toPixelY(y) {
	return y * globalSettings.spriteSize + globalSettings.scoreBoardArea
}

export function useGraphicsEngine() {
	return {
		initialise(canvasContext, graphicsFile) {
			canvas = canvasContext
			spriteSheet = new Image()
			spriteSheet.src = graphicsFile
		},

		blankScreen() {
			canvas.fillStyle = globalSettings.gameBoardBackgroundColour
			canvas.fillRect(
				0,
				0,
				globalSettings.gameBoardWidth * globalSettings.spriteSize,
				globalSettings.scoreBoardArea + globalSettings.gameBoardHeight * globalSettings.spriteSize,
			)
		},

		drawText(coordSys, x, y, text, colour, font) {
			const px = coordSys === coordinateSystem.world ? toPixelX(x) : x
			const py = coordSys === coordinateSystem.world ? toPixelY(y) : y
			canvas.fillStyle = colour
			canvas.font = font
			canvas.fillText(text, px, py)
		},

		drawImage(coordSys, x, y, image) {
			const px = coordSys === coordinateSystem.world ? toPixelX(x) : x
			const py = coordSys === coordinateSystem.world ? toPixelY(y) : y
			const s = globalSettings.spriteSize
			canvas.drawImage(
				spriteSheet,
				s * (image % globalSettings.spriteSheetWidth),
				s * Math.floor(image / globalSettings.spriteSheetWidth),
				s, s, px, py, s, s,
			)
		},
	}
}
