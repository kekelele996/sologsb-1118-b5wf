import type { Stratum } from './stratum'

/** 样品类型 */
export const SAMPLE_TYPES = ['土样', '炭样', '骨样', '陶片样', '其他'] as const
export type SampleType = (typeof SAMPLE_TYPES)[number]

/** 检测用途 */
export const TEST_PURPOSES = ['浮选', '碳十四测年', '孢粉分析', '植硅体分析', '成分检测'] as const
export type TestPurpose = (typeof TEST_PURPOSES)[number]

/** 样品状态 */
export const SAMPLE_STATUSES = ['待送检', '已送检', '已收样', '已退样'] as const
export type SampleStatus = (typeof SAMPLE_STATUSES)[number]

/** 收样/退样记录类型 */
export const SAMPLE_LOG_TYPES = ['收样', '退样'] as const
export type SampleLogType = (typeof SAMPLE_LOG_TYPES)[number]

/** 催办宽限天数：约定收样日过后多少天仍未收样即触发催办 */
export const SAMPLE_GRACE_DAYS = 7

/** SampleLog 收样/退样流水（追加式，保存后不可修改） */
export interface SampleLog {
  id: string
  type: SampleLogType
  date: string
  /** 经办人 */
  operator: string
  note: string
}

/** Sample 送检样品 */
export interface Sample {
  id: string
  /** 所属地层单位（登记时锁定） */
  stratumId: string
  /** 样品号（同一探方内唯一） */
  code: string
  type: SampleType
  /** 采集深度（距地表，米） */
  depth: number
  collectDate: string
  /** 采集人 */
  collector: string
  /** 实验室（确认送检后锁定） */
  lab: string
  /** 检测用途（确认送检后锁定） */
  purpose: TestPurpose | ''
  /** 送检日期（确认送检后锁定） */
  submitDate: string
  /** 约定收样日期 */
  dueDate: string
  /** 收样/退样流水 */
  logs: SampleLog[]
  note: string
}

/** 样品状态：由送检日期与收退样流水推导，不单独落库 */
export function sampleStatus(sample: Pick<Sample, 'submitDate' | 'logs'>): SampleStatus {
  if (!sample.submitDate) return '待送检'
  const last = sample.logs[sample.logs.length - 1]
  if (last?.type === '退样') return '已退样'
  if (last?.type === '收样') return '已收样'
  return '已送检'
}

/** 同一探方内样品号是否重复（按样品所属地层单位反查探方） */
export function isSampleCodeDuplicated(
  samples: Sample[],
  strata: Pick<Stratum, 'id' | 'trenchId'>[],
  candidate: Pick<Sample, 'id' | 'stratumId' | 'code'>
): boolean {
  const trenchId = strata.find((item) => item.id === candidate.stratumId)?.trenchId
  if (!trenchId) return false
  const code = candidate.code.trim().toUpperCase()
  return samples.some((item) => {
    if (item.id === candidate.id || item.code.trim().toUpperCase() !== code) return false
    return strata.find((row) => row.id === item.stratumId)?.trenchId === trenchId
  })
}

/** 采集深度是否超出地层单位深度区间 */
export function isDepthOutOfRange(stratum: Pick<Stratum, 'topDepth' | 'bottomDepth'>, depth: number): boolean {
  return depth < stratum.topDepth || depth > stratum.bottomDepth
}

/** 约定收样日至今已过去的天数（仅统计已送检未收样的样品，其余返回 0） */
export function daysPastDue(sample: Pick<Sample, 'submitDate' | 'dueDate' | 'logs'>, today = new Date()): number {
  if (sampleStatus(sample) !== '已送检' || !sample.dueDate) return 0
  const due = new Date(`${sample.dueDate}T00:00:00`).getTime()
  if (Number.isNaN(due)) return 0
  const now = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  return Math.max(0, Math.round((now - due) / 86400000))
}

/** 是否触发催办：约定收样日期过了 7 天仍未收样 */
export function isSampleOverdue(sample: Pick<Sample, 'submitDate' | 'dueDate' | 'logs'>, today = new Date()): boolean {
  return daysPastDue(sample, today) > SAMPLE_GRACE_DAYS
}
