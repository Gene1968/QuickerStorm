<script setup>
import { ref, nextTick } from 'vue'
import { useLocalChat } from '@/composables/useLocalChat'
const { messages, send } = useLocalChat()
const input = ref('')
const msgEl = ref(null)

async function submit() {
  const msg = input.value.trim()
  if (!msg) return
  send(msg)
  input.value = ''
  await nextTick()
  if (msgEl.value) msgEl.value.scrollTop = 0
}

// chatType 0=whisper 1=normal 2=shout — colour-code
const TYPE_CLASS = { 0: 'text-white/50 italic', 1: 'text-white', 2: 'text-yellow-400 font-semibold' }
</script>

<template>
  <div class="flex flex-col bg-black/60 border-t border-brd shrink-0" style="max-height: 180px">
    <!-- Header -->
    <div class="flex items-center px-3 py-0.5 border-b border-white/10">
      <span class="text-white/60 text-xs uppercase tracking-widest">Nearby Chat</span>
    </div>

    <!-- Message history -->
    <div ref="msgEl" class="flex-1 overflow-y-auto px-3 py-1 flex flex-col-reverse gap-0.5 min-h-[60px]">
      <div
        v-for="m in [...messages].reverse().slice(0, 60)"
        :key="m.id"
        :class="['text-sm leading-snug', TYPE_CLASS[m.chatType] ?? 'text-white']"
      >
        <span class="text-accent font-medium">{{ m.fromName }}:</span>
        {{ m.message }}
      </div>
      <div v-if="!messages.length" class="text-white/30 text-xs italic">No messages yet.</div>
    </div>

    <!-- Input -->
    <form class="flex gap-2 px-2 py-1.5 border-t border-white/10" @submit.prevent="submit">
      <input
        v-model="input"
        type="text"
        placeholder="Say something… (Enter to send)"
        class="flex-1 bg-white/10 border border-white/20 text-white placeholder-white/30 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
        maxlength="1023"
      />
      <button type="submit" class="px-3 py-1 bg-accent text-white rounded text-sm hover:opacity-80 shrink-0">
        Send
      </button>
    </form>
  </div>
</template>
