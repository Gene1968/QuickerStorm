import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useGridStore } from '@/stores/gridStore'

beforeEach(() => setActivePinia(createPinia()))

describe('gridStore', () => {
  it('has grids list', () => {
    const store = useGridStore()
    expect(store.grids.length).toBeGreaterThan(0)
  })

  it('selects a grid', () => {
    const store = useGridStore()
    store.selectGrid('osgrid')
    expect(store.selectedGrid?.nick).toBe('osgrid')
  })

  it('loginState defaults to idle', () => {
    const store = useGridStore()
    expect(store.loginState).toBe('idle')
  })
})
