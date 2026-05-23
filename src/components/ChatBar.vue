<script setup>
import { ref } from 'vue'
import { useLocalChat } from '@/composables/useLocalChat'
const { messages, send } = useLocalChat()
const input = ref('')

function submit() {
  const msg = input.value.trim()
  if (!msg) return
  send(msg)
  input.value = ''
}

// WHY: chatType 0=whisper, 1=normal, 2=shout — colour-code in history
const TYPE_CLASS = { 0: 'text-t2 italic', 1: 'text-t1', 2: 'text-yellow-400 font-semibold' }
</script>

<template>
  <div class="absolute bottom-0 left-0 right-48 flex flex-col">
    <!-- Message history -->
    <div class="max-h-36 overflow-y-auto px-3 py-1 flex flex-col-reverse gap-0.5 bg-black/40">
      <div
        v-for="m in [...messages].reverse().slice(0, 40)"
        :key="m.id"
        :class="['text-sm', TYPE_CLASS[m.chatType] ?? 'text-t1']"
      >
        <span class="text-accent font-medium">{{ m.fromName }}:</span>
        {{ m.message }}
      </div>
    </div>
    <!-- Input -->
    <form
      class="flex gap-2 px-3 py-2 bg-black/60 backdrop-blur border-t border-brd"
      @submit.prevent="submit"
    >
      <input
        v-model="input"
        type="text"
        placeholder="Say something…"
        class="flex-1 bg-card border border-brd text-t1 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
        maxlength="1023"
      />
      <button type="submit" class="px-3 py-1 bg-accent text-white rounded text-sm hover:opacity-80">
        Send
      </button>
    </form>
  </div>
</template>
