<script setup>
import { use2DFallback } from '@/composables/use2DFallback'
import { useUiStore } from '@/stores/uiStore'
import WorldCanvas     from '@/components/WorldCanvas.vue'
import SimpleWorldView from '@/components/SimpleWorldView.vue'
import HUDLayer        from '@/components/HUDLayer.vue'
import AvatarList      from '@/components/AvatarList.vue'
import MinimapOverlay  from '@/components/MinimapOverlay.vue'
import ChatBar         from '@/components/ChatBar.vue'

const { is2D, setMode } = use2DFallback()
const ui = useUiStore()
</script>

<template>
  <div class="w-screen h-screen overflow-hidden bg-bg relative">

    <!-- 2D fallback (mobile / no WebGL) -->
    <SimpleWorldView v-if="is2D" />

    <!-- 3D world -->
    <template v-else>
      <WorldCanvas class="absolute inset-0" />
      <HUDLayer />
      <AvatarList      v-if="ui.showAvatarList" />
      <MinimapOverlay  v-if="ui.showMinimap" />
      <ChatBar         v-if="ui.showChat" />

      <!-- 2D-mode toggle -->
      <button
        class="absolute top-2 right-52 text-xs bg-black/50 text-white px-2 py-0.5 rounded hover:bg-black/70"
        @click="setMode('2d')"
      >
        2D View
      </button>
    </template>

  </div>
</template>
