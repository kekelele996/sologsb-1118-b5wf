import { onUnmounted, reactive } from 'vue'
import type { StoreApi } from 'zustand/vanilla'
import Dexie, { type Table } from 'dexie'
import type { Artifact, Relation, Sample, Stratum, Trench } from '@/types'

/** IndexedDB 数据结构版本号 */
export const SCHEMA_VERSION = 3

export interface MetaRow {
  key: string
  value: number
}

/** Dexie 封装：探方 / 地层单位 / 出土物 / 层位关系 / 送检样品 五张表 + 元数据表 */
class TrenchLogDb extends Dexie {
  trenches!: Table<Trench, string>
  strata!: Table<Stratum, string>
  artifacts!: Table<Artifact, string>
  relations!: Table<Relation, string>
  samples!: Table<Sample, string>
  meta!: Table<MetaRow, string>

  constructor() {
    super('gbtrenchlog')
    this.version(1).stores({
      trenches: 'id, code, area',
      strata: 'id, trenchId, code, type',
      artifacts: 'id, stratumId, code, category',
      relations: 'id, unitAId, unitBId, type',
      meta: 'key'
    })
    // v2：地层单位新增「开口层位」字段，迁移时为历史数据补齐默认值
    this.version(2)
      .stores({
        trenches: 'id, code, area, backfilled',
        strata: 'id, trenchId, code, type, topDepth',
        artifacts: 'id, stratumId, code, category, date',
        relations: 'id, unitAId, unitBId, type, basis',
        meta: 'key'
      })
      .upgrade(async (tx) => {
        await tx
          .table<Stratum, string>('strata')
          .toCollection()
          .modify((stratum) => {
            if (!stratum.openLayer) {
              stratum.openLayer = '第①层'
            }
            if (!Array.isArray(stratum.inclusions)) {
              stratum.inclusions = []
            }
          })
      })
    // v3：新增样品送检台账表（新表无需迁移历史数据）
    this.version(SCHEMA_VERSION).stores({
      trenches: 'id, code, area, backfilled',
      strata: 'id, trenchId, code, type, topDepth',
      artifacts: 'id, stratumId, code, category, date',
      relations: 'id, unitAId, unitBId, type, basis',
      samples: 'id, trenchId, stratumId, code, sendDate',
      meta: 'key'
    })
  }
}

export const db = new TrenchLogDb()

/** 写入当前数据结构版本号 */
export async function stampDbVersion(): Promise<void> {
  await db.meta.put({ key: 'schemaVersion', value: SCHEMA_VERSION })
}

/** 读取整表 */
export async function syncAll<T extends object>(table: Table<T, string>): Promise<T[]> {
  return table.toArray()
}

/** 写入一条记录 */
export async function syncPut<T extends object>(table: Table<T, string>, row: T): Promise<void> {
  await table.put(row)
}

/** 删除一条记录 */
export async function syncDelete<T extends object>(table: Table<T, string>, id: string): Promise<void> {
  await table.delete(id)
}

/** Zustand vanilla store → Vue 响应式桥接 */
export function useStore<T extends object>(store: StoreApi<T>): T {
  const state = reactive({ ...store.getState() }) as T
  const unsubscribe = store.subscribe((next: T) => {
    Object.assign(state, next)
  })
  onUnmounted(() => unsubscribe())
  return state
}

/** 首次打开写入示例数据 */
export async function seedDemoData(): Promise<void> {
  const count = await db.trenches.count()
  if (count > 0) return

  const today = new Date().toISOString().slice(0, 10)

  await db.trenches.bulkPut([
    {
      id: 'tr_0501',
      code: 'T0501',
      area: 'Ⅱ区',
      size: '5×5 米',
      basePoint: 'N1200 / E3000',
      openLayer: '第①层',
      startDate: today,
      endDate: '',
      leader: '方铭',
      wallNote: '北壁、东壁保存较好；南壁被现代扰坑破坏',
      backfilled: false
    },
    {
      id: 'tr_0502',
      code: 'T0502',
      area: 'Ⅱ区',
      size: '5×5 米',
      basePoint: 'N1205 / E3000',
      openLayer: '第①层',
      startDate: today,
      endDate: today,
      leader: '方铭',
      wallNote: '四壁规整，西壁可见 H12 剖面',
      backfilled: true
    }
  ])

  await db.strata.bulkPut([
    {
      id: 'st_0501_l1',
      trenchId: 'tr_0501',
      code: 'L01',
      type: '地层',
      openLayer: '第①层',
      topDepth: 0,
      bottomDepth: 0.25,
      soil: '灰褐色砂质黏土，疏松',
      inclusions: ['陶片', '炭屑'],
      formation: '近现代耕土层',
      date: today,
      drawingNo: 'T0501-北壁-01'
    },
    {
      id: 'st_0501_l2',
      trenchId: 'tr_0501',
      code: 'L02',
      type: '地层',
      openLayer: '第②层',
      topDepth: 0.25,
      bottomDepth: 0.6,
      soil: '黄褐色黏土，致密',
      inclusions: ['陶片', '骨'],
      formation: '汉代文化层',
      date: today,
      drawingNo: 'T0501-北壁-02'
    },
    {
      id: 'st_0501_h12',
      trenchId: 'tr_0501',
      code: 'H12',
      type: '灰坑',
      openLayer: '第②层下',
      topDepth: 0.6,
      bottomDepth: 1.4,
      soil: '深灰褐土，含大量灰烬',
      inclusions: ['陶片', '骨', '炭屑'],
      formation: '生活垃圾坑',
      date: today,
      drawingNo: 'T0501-H12-平剖面'
    },
    {
      id: 'st_0502_l1',
      trenchId: 'tr_0502',
      code: 'L01',
      type: '地层',
      openLayer: '第①层',
      topDepth: 0,
      bottomDepth: 0.3,
      soil: '灰褐色砂质黏土',
      inclusions: ['陶片'],
      formation: '耕土层',
      date: today,
      drawingNo: 'T0502-西壁-01'
    }
  ])

  await db.artifacts.bulkPut([
    {
      id: 'af_001',
      stratumId: 'st_0501_l2',
      code: 'T0501②:1',
      category: '陶器',
      count: 3,
      completeness: '残片',
      x: 2.4,
      y: 1.8,
      z: 0.42,
      date: today,
      collector: '祁野',
      tempLocation: '工地临时柜 A-2'
    },
    {
      id: 'af_002',
      stratumId: 'st_0501_h12',
      code: 'T0501H12:1',
      category: '骨器',
      count: 1,
      completeness: '可复原',
      x: 3.1,
      y: 3.6,
      z: 1.05,
      date: today,
      collector: '祁野',
      tempLocation: '工地临时柜 A-3'
    }
  ])

  await db.relations.bulkPut([
    {
      id: 'rl_001',
      unitAId: 'st_0501_h12',
      type: '打破',
      unitBId: 'st_0501_l2',
      basis: '剖面观察',
      recorder: '方铭',
      note: 'H12 开口于第②层下，打破 L02'
    },
    {
      id: 'rl_002',
      unitAId: 'st_0501_l1',
      type: '叠压',
      unitBId: 'st_0501_l2',
      basis: '剖面观察',
      recorder: '方铭',
      note: 'L01 叠压 L02，界面清晰'
    }
  ])

  const offsetDate = (offsetDays: number): string => {
    // 统一按 UTC 日历日偏移，与 new Date().toISOString() 取日期及催办天数计算口径一致
    const date = new Date()
    const base = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
    return new Date(base + offsetDays * 86400000).toISOString().slice(0, 10)
  }

  await db.samples.bulkPut([
    {
      id: 'sp_001',
      code: 'T0501-C01',
      trenchId: 'tr_0501',
      stratumId: 'st_0501_h12',
      type: '炭样',
      depth: 0.9,
      collectDate: offsetDate(-2),
      collector: '祁野',
      quantity: '2 袋 / 约 30g',
      remark: 'H12 坑底灰烬集中处采集，拟送碳十四测年',
      lab: '',
      sendDate: '',
      purpose: '',
      expectedReceiveDate: '',
      events: []
    },
    {
      id: 'sp_002',
      code: 'T0501-S02',
      trenchId: 'tr_0501',
      stratumId: 'st_0501_l2',
      type: '土样',
      depth: 0.45,
      collectDate: offsetDate(-15),
      collector: '祁野',
      quantity: '500g',
      remark: '第②层中部取样，浮选备用',
      lab: '省文物考古研究院科技考古室',
      sendDate: offsetDate(-12),
      purpose: '浮选与植物考古分析',
      expectedReceiveDate: offsetDate(-10),
      events: []
    },
    {
      id: 'sp_003',
      code: 'T0502-P01',
      trenchId: 'tr_0502',
      stratumId: 'st_0502_l1',
      type: '孢粉样',
      depth: 0.15,
      collectDate: offsetDate(-12),
      collector: '方铭',
      quantity: '200g',
      remark: '耕土层下部，注意现代污染',
      lab: '北大考古年代学实验室',
      sendDate: offsetDate(-9),
      purpose: '孢粉分析',
      expectedReceiveDate: offsetDate(-5),
      events: [
        {
          id: 'se_003_01',
          type: '收样',
          date: offsetDate(-3),
          handler: '实验室值班员 周知',
          note: '样品袋完整、标签清晰，已编号入库'
        }
      ]
    },
    {
      id: 'sp_004',
      code: 'T0501-S04',
      trenchId: 'tr_0501',
      stratumId: 'st_0501_l1',
      type: '土样',
      depth: 0.12,
      collectDate: offsetDate(-20),
      collector: '祁野',
      quantity: '500g',
      remark: '耕土层样，含水量偏高',
      lab: '高校环境考古实验室',
      sendDate: offsetDate(-18),
      purpose: '粒度分析',
      expectedReceiveDate: offsetDate(-14),
      events: [
        {
          id: 'se_004_01',
          type: '退样',
          date: offsetDate(-8),
          handler: '实验室收发 林岚',
          note: '样品袋破损、污染严重，不符合检测要求，原件退回'
        }
      ]
    }
  ])
}
