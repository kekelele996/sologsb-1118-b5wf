import { createStore } from 'zustand/vanilla'
import type { Sample } from '@/types'
import { db, syncAll, syncDelete, syncPut } from '@/hooks/usePersistentStore'

export interface SampleState {
  samples: Sample[]
  loaded: boolean
  hydrate: () => Promise<void>
  save: (sample: Sample) => Promise<void>
  remove: (id: string) => Promise<void>
}

export const sampleStore = createStore<SampleState>((set, get) => ({
  samples: [],
  loaded: false,
  hydrate: async () => {
    const samples = await syncAll<Sample>(db.samples)
    samples.sort((a, b) => a.code.localeCompare(b.code, 'zh-Hans-CN', { numeric: true }))
    set({ samples, loaded: true })
  },
  save: async (sample) => {
    await syncPut<Sample>(db.samples, sample)
    await get().hydrate()
  },
  remove: async (id) => {
    await syncDelete<Sample>(db.samples, id)
    await get().hydrate()
  }
}))
