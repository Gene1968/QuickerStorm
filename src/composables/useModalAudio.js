import { onMounted, onUnmounted } from 'vue'
import { useAudio } from './useAudio.js'

export function useModalAudio() {
	const { playSound } = useAudio()
	onMounted(() => playSound('ui-open.mp3'))
	onUnmounted(() => playSound('ui-dismiss.mp3'))
}
