<script setup>
import { useWorldStore } from '@/stores/worldStore'
const world = useWorldStore()
</script>

<template>
  <div class="absolute right-0 top-0 h-full w-48 bg-black/60 backdrop-blur border-l border-brd overflow-y-auto">
    <p class="text-t2 text-xs px-3 py-2 uppercase tracking-wide">
      Nearby ({{ world.avatars.length }})
    </p>
    <ul>
      <li
        v-for="av in world.avatars"
        :key="av.localId"
        class="px-3 py-1 text-sm text-t1 truncate hover:bg-white/10"
      >
        {{ av.name || av.fullId?.slice(0, 8) || 'Avatar' }}
      </li>
    </ul>
  </div>
</template>
