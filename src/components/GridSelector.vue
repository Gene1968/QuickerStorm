<script setup>
import { useGridStore } from '@/stores/gridStore'
const store = useGridStore()
</script>

<template>
  <select
    class="w-full px-3 py-2 rounded bg-card border border-brd text-t1 focus:outline-none focus:ring-2 focus:ring-accent"
    :value="store.selectedNick"
    @change="store.selectGrid($event.target.value)"
  >
    <option v-for="g in store.grids" :key="g.nick" :value="g.nick">{{ g.name }}</option>
  </select>
</template>
