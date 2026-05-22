import { ref } from 'vue'
import { useAudio } from '@/composables/useAudio.js'

const depth = ref(0)
const { playSound } = useAudio()

export const anyModalOpen = () => depth.value > 0
export const openModal  = () => { depth.value++; playSound('ui-open.mp3') }
export const closeModal = () => { depth.value = Math.max(0, depth.value - 1); playSound('ui-dismiss.mp3') }
