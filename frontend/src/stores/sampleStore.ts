import { createStore } from 'zustand/vanilla'
import type { Sample, SampleEvent } from '@/types'
import { isSampleSent } from '@/types'
import { db, syncAll, syncDelete, syncPut } from '@/hooks/usePersistentStore'

/** 尝试修改已送检样品时抛出，页面据此提示「送检后不可撤销」 */
export class SampleLockedError extends Error {
  constructor(message = '样品已确认送检，实验室、送检日期与检测用途已锁定，不能再修改或删除') {
    super(message)
    this.name = 'SampleLockedError'
  }
}

export interface SampleState {
  samples: Sample[]
  loaded: boolean
  hydrate: () => Promise<void>
  /** 新建或保存待送检样品；深度区间与样品号唯一性由页面校验 */
  save: (sample: Sample) => Promise<void>
  remove: (id: string) => Promise<void>
  removeByStratum: (stratumId: string) => Promise<void>
  /** 确认送检：锁定实验室、送检日期、检测用途与约定收样日期，锁定后不可撤销 */
  confirmSend: (
    id: string,
    payload: Pick<Sample, 'lab' | 'sendDate' | 'purpose' | 'expectedReceiveDate'>
  ) => Promise<void>
  /** 送检后仅允许追加收样 / 退样台账 */
  appendEvent: (id: string, event: SampleEvent) => Promise<void>
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
    const existing = get().samples.find((item) => item.id === sample.id)
    if (existing && isSampleSent(existing)) {
      throw new SampleLockedError()
    }
    await syncPut<Sample>(db.samples, sample)
    await get().hydrate()
  },
  remove: async (id) => {
    const existing = get().samples.find((item) => item.id === id)
    if (existing && isSampleSent(existing)) {
      throw new SampleLockedError('已送检样品不能删除，送检记录不可撤销')
    }
    await syncDelete<Sample>(db.samples, id)
    await get().hydrate()
  },
  removeByStratum: async (stratumId) => {
    // 已送检样品不可删除：单位删除前页面应先拦截，这里仅清理待送检样品
    const targets = get().samples.filter((item) => item.stratumId === stratumId && !isSampleSent(item))
    await Promise.all(targets.map((item) => syncDelete<Sample>(db.samples, item.id)))
    await get().hydrate()
  },
  confirmSend: async (id, payload) => {
    const existing = get().samples.find((item) => item.id === id)
    if (!existing) return
    if (isSampleSent(existing)) {
      throw new SampleLockedError('该样品已确认送检，不能重复送检')
    }
    await syncPut<Sample>(db.samples, {
      ...existing,
      lab: payload.lab.trim(),
      sendDate: payload.sendDate,
      purpose: payload.purpose.trim(),
      expectedReceiveDate: payload.expectedReceiveDate
    })
    await get().hydrate()
  },
  appendEvent: async (id, event) => {
    const existing = get().samples.find((item) => item.id === id)
    if (!existing) return
    if (!isSampleSent(existing)) {
      throw new Error('样品尚未确认送检，请先完成送检')
    }
    await syncPut<Sample>(db.samples, { ...existing, events: [...existing.events, event] })
    await get().hydrate()
  }
}))
