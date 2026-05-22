<script setup>
import GridSelector from '@/components/GridSelector.vue'
import LoginForm from '@/components/LoginForm.vue'
import { useTheme } from '@/composables/useTheme'
const { isDark, toggle } = useTheme()
</script>

<template>
  <div class="min-h-screen bg-bg flex flex-col items-center justify-center px-4">

    <!-- Header -->
    <div class="w-full max-w-md mb-8 flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-bold text-t1 tracking-tight">quicker<span class="font-black">STORM</span></h1>
        <p class="text-t2 text-sm mt-1">Web viewer for OpenSimulator &amp; Second Life</p>
      </div>
      <button class="text-t2 hover:text-t1 transition-colors text-xl" @click="toggle" :title="isDark ? 'Light mode' : 'Dark mode'">
        {{ isDark ? '☀' : '🌙' }}
      </button>
    </div>

    <!-- Login card -->
    <div class="w-full max-w-md bg-card border border-brd rounded-xl p-6 flex flex-col gap-4 shadow-lg">
      <div>
        <label class="block text-t2 text-xs mb-1 uppercase tracking-wide">Grid</label>
        <GridSelector />
      </div>
      <LoginForm />
    </div>

    <!-- Disclaimer -->
    <div class="w-full max-w-md mt-6 text-center text-t2 text-xs leading-relaxed">
      <p>
        quickerSTORM is an independent open-source project.<br/>
        Not affiliated with, endorsed by, or sponsored by Linden Research, Inc.<br/>
        <em>Second Life®</em> is a registered trademark of Linden Research, Inc.
      </p>
      <p class="mt-2">
        Credentials are transmitted once for grid login only and are never stored.<br/>
        Session token held in browser memory only.
      </p>
      <p class="mt-3 opacity-60">
        Inspired by Firestorm Viewer · SpeedLight · Built with Vue 3 · Three.js · Bun · WebRTC
      </p>
    </div>

  </div>
</template>
