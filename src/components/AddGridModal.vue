<script setup>
import { ref, computed } from 'vue'
import { useGridStore } from '@/stores/gridStore'

const emit  = defineEmits(['close'])
const store = useGridStore()

const form = ref({
  name:      '',
  loginURI:  '',
  slurlBase: '',
  platform:  'OpenSim',
  about:     '',
  register:  '',
  password:  '',
})

// Auto-derive nick from name
const nick = computed(() =>
  form.value.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
)

// Auto-derive slurlBase from loginURI if blank
const slurlBase = computed(() => {
  if (form.value.slurlBase.trim()) return form.value.slurlBase.trim()
  try {
    const u = new URL(form.value.loginURI)
    return `hop://${u.host}/`
  } catch { return '' }
})

const error = ref('')

function validate() {
  if (!form.value.name.trim())    return 'Name is required'
  if (!nick.value)                return 'Name must contain at least one letter or number'
  try { new URL(form.value.loginURI) } catch { return 'Login URI must be a valid URL (e.g. http://mygrid.com:8002/)' }
  return ''
}

function submit() {
  error.value = validate()
  if (error.value) return

  store.addUserGrid({
    nick:      nick.value,
    name:      form.value.name.trim(),
    loginURI:  form.value.loginURI.trim(),
    slurlBase: slurlBase.value,
    platform:  form.value.platform,
    about:     form.value.about.trim() || undefined,
    register:  form.value.register.trim() || undefined,
    password:  form.value.password.trim() || undefined,
    loginIdentifierTypes: ['agent', 'account'],
  })
  emit('close')
}

// Permanent-add request — opens GitHub issues or mailto
const REQUEST_URL = 'mailto:gene@unforgettable.com?subject=QuickerSTORM%20Grid%20Addition%20Request'
</script>

<template>
  <!-- Backdrop -->
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" @click.self="$emit('close')">
    <div class="w-full max-w-md bg-card border border-brd rounded-xl shadow-2xl p-6 flex flex-col gap-4">

      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold text-t1">Add Grid</h2>
        <button class="text-t2 hover:text-t1 text-xl leading-none" @click="$emit('close')">×</button>
      </div>

      <p class="text-xs text-t2">
        Grid is saved in your browser only. Want it added permanently?
        <a :href="REQUEST_URL" class="text-accent hover:underline">Send a request.</a>
      </p>

      <!-- Error banner -->
      <p v-if="error" class="text-xs text-red-400 bg-red-400/10 rounded-sm px-3 py-2">{{ error }}</p>

      <form class="flex flex-col gap-3" @submit.prevent="submit">

        <div>
          <label class="block text-t2 text-xs mb-1">Grid Name <span class="text-red-400">*</span></label>
          <input
            v-model="form.name"
            type="text"
            placeholder="My Awesome Grid"
            class="w-full px-3 py-2 rounded-sm bg-bg border border-brd text-t1 text-sm focus:outline-hidden focus:ring-1 focus:ring-accent"
            required
          />
          <p v-if="nick" class="text-t2 text-xs mt-0.5">Nick: <code class="text-accent">{{ nick }}</code></p>
        </div>

        <div>
          <label class="block text-t2 text-xs mb-1">Login URI <span class="text-red-400">*</span></label>
          <input
            v-model="form.loginURI"
            type="url"
            placeholder="http://mygrid.com:8002/"
            class="w-full px-3 py-2 rounded-sm bg-bg border border-brd text-t1 text-sm focus:outline-hidden focus:ring-1 focus:ring-accent"
            required
          />
        </div>

        <div>
          <label class="block text-t2 text-xs mb-1">SLURL / Hop Base <span class="text-t2">(optional — auto-derived)</span></label>
          <input
            v-model="form.slurlBase"
            type="text"
            :placeholder="slurlBase || 'hop://mygrid.com:8002/'"
            class="w-full px-3 py-2 rounded-sm bg-bg border border-brd text-t1 text-sm focus:outline-hidden focus:ring-1 focus:ring-accent"
          />
        </div>

        <div>
          <label class="block text-t2 text-xs mb-1">Platform</label>
          <div class="flex gap-4">
            <label class="flex items-center gap-1.5 text-sm text-t1 cursor-pointer">
              <input type="radio" v-model="form.platform" value="OpenSim" class="accent-accent" /> OpenSim
            </label>
            <label class="flex items-center gap-1.5 text-sm text-t1 cursor-pointer">
              <input type="radio" v-model="form.platform" value="SecondLife" class="accent-accent" /> Second Life
            </label>
          </div>
        </div>

        <!-- Optional links (collapsible) -->
        <details class="text-sm">
          <summary class="text-t2 text-xs cursor-pointer hover:text-t1">Optional links (about, register, forgot password)</summary>
          <div class="mt-2 flex flex-col gap-2">
            <input v-model="form.about"    type="url" placeholder="About URL" class="w-full px-3 py-1.5 rounded-sm bg-bg border border-brd text-t1 text-xs focus:outline-hidden focus:ring-1 focus:ring-accent" />
            <input v-model="form.register" type="url" placeholder="Register URL" class="w-full px-3 py-1.5 rounded-sm bg-bg border border-brd text-t1 text-xs focus:outline-hidden focus:ring-1 focus:ring-accent" />
            <input v-model="form.password" type="url" placeholder="Forgot Password URL" class="w-full px-3 py-1.5 rounded-sm bg-bg border border-brd text-t1 text-xs focus:outline-hidden focus:ring-1 focus:ring-accent" />
          </div>
        </details>

        <div class="flex gap-2 pt-1">
          <button type="submit" class="flex-1 py-2 bg-accent text-white rounded-sm text-sm font-medium hover:opacity-80">
            Add Grid
          </button>
          <button type="button" class="px-4 py-2 border border-brd text-t2 rounded-sm text-sm hover:text-t1" @click="$emit('close')">
            Cancel
          </button>
        </div>

      </form>

    </div>
  </div>
</template>
