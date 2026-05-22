// src/stores/chatStore.js — local chat message ring buffer
import { defineStore } from 'pinia'
import { ref } from 'vue'

const MAX_MESSAGES = 200

export const useChatStore = defineStore('chat', () => {
	const messages = ref([])  // [{ id, fromName, message, chatType, timestamp }]

	function addMessage(msg) {
		messages.value.push({ id: crypto.randomUUID(), timestamp: Date.now(), ...msg })
		if (messages.value.length > MAX_MESSAGES) messages.value.shift()
	}

	function clear() { messages.value = [] }

	return { messages, addMessage, clear }
})
