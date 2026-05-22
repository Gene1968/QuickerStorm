<script setup>
import { ref } from 'vue'
import { useGridLogin } from '@/composables/useGridLogin'
import { useGridStore } from '@/stores/gridStore'

const { login } = useGridLogin()
const gridStore = useGridStore()

const username = ref('')
const password = ref('')
const error    = ref('')

async function submit() {
  error.value = ''
  try {
    await login(username.value, password.value)
  } catch (e) {
    error.value = e.message
  }
}
</script>

<template>
  <form class="flex flex-col gap-3" @submit.prevent="submit">
    <input
      v-model="username"
      type="text"
      placeholder="First Last"
      autocomplete="username"
      class="px-3 py-2 rounded bg-card border border-brd text-t1 placeholder-t2 focus:outline-none focus:ring-2 focus:ring-accent"
      required
    />
    <input
      v-model="password"
      type="password"
      placeholder="Password"
      autocomplete="current-password"
      class="px-3 py-2 rounded bg-card border border-brd text-t1 focus:outline-none focus:ring-2 focus:ring-accent"
      required
    />
    <button
      type="submit"
      class="px-4 py-2 rounded bg-accent text-white font-semibold hover:bg-accent2 disabled:opacity-50 transition-colors"
      :disabled="gridStore.loginState === 'loading'"
    >
      {{ gridStore.loginState === 'loading' ? 'Connecting…' : 'Log In' }}
    </button>
    <p v-if="error" class="text-red-400 text-sm">{{ error }}</p>
  </form>
</template>
