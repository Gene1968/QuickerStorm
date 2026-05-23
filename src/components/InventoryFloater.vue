<script setup>
import { useUiStore } from '@/stores/uiStore'
const ui = useUiStore()
</script>

<template>
  <div
    class="absolute right-48 top-12 w-64
           bg-black/90 border border-white/20 rounded-lg shadow-2xl z-50 flex flex-col overflow-hidden"
  >
    <!-- Header -->
    <div class="flex items-center px-3 py-2 bg-white/5 border-b border-white/10">
      <span class="text-white text-sm font-medium flex-1">📦 Inventory</span>
      <button class="text-white/50 hover:text-white text-lg leading-none" title="Close" @click="ui.toggleInventory()">×</button>
    </div>

    <!-- Body -->
    <div class="p-4 text-center text-white/40 text-sm italic">
      <p class="mb-1">📦</p>
      <p>Inventory viewer coming in Phase 2.</p>
      <p class="text-xs mt-2 text-white/25">Full in-world inventory browsing, attachment, and wearables.</p>
    </div>
  </div>
</template>
