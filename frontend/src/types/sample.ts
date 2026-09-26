/** 样品种类 */
export const SAMPLE_TYPES = ['土样', '炭样', '孢粉样', '植硅体样', '其他'] as const
export type SampleType = (typeof SAMPLE_TYPES)[number]

/** 样品流转状态：只在台账中流转，不做持久化字段 */
export const SAMPLE_STATUS = {
  /** 待送检：已登记，尚未确认送检，可继续修改 */
  Pending: '待送检',
  /** 已送检：实验室/送检日期/检测用途已锁定，不可撤销 */
  Submitted: '已送检',
  /** 已收样：实验室确认收到 */
  Received: '已收样',
  /** 已退样：送检后发生退回 */
  Returned: '已退样'
} as const
export type SampleStatus = (typeof SAMPLE_STATUS)[keyof typeof SAMPLE_STATUS]

/** 台账事件类型（确认送检后只能追加这两类） */
export const SAMPLE_EVENT_TYPES = ['收样', '退样'] as const
export type SampleEventType = (typeof SAMPLE_EVENT_TYPES)[number]

/** 收样 / 退样台账记录 */
export interface SampleEvent {
  id: string
  type: SampleEventType
  /** 收样或退样日期 */
  date: string
  /** 经手人（实验室收样人 / 退样经办人） */
  handler: string
  note: string
}

/** Sample 送检样品 */
export interface Sample {
  id: string
  /** 样品编号，同一探方内唯一 */
  code: string
  /** 所属探方（由地层单位带出，单独冗余便于唯一性校验与筛选） */
  trenchId: string
  /** 所属地层单位（登记时从已有探方、地层单位中选择） */
  stratumId: string
  type: SampleType
  /** 采集深度（距地表，米），必须落在所选地层单位深度区间内 */
  depth: number
  /** 采集日期 */
  collectDate: string
  /** 采集人 */
  collector: string
  /** 数量/规格，如 500g、2 袋 */
  quantity: string
  /** 备注 */
  remark: string
  /** 送检实验室（确认送检时锁定） */
  lab: string
  /** 送检日期（确认送检时锁定） */
  sendDate: string
  /** 检测用途（确认送检时锁定），如 碳十四测年、孢粉分析 */
  purpose: string
  /** 与实验室约定的收样日期；超过该日期 7 天仍未收样则催办 */
  expectedReceiveDate: string
  /** 收样 / 退样台账，按追加顺序保存；为空数组表示尚未确认送检或已送检无回执 */
  events: SampleEvent[]
}

/** 是否已经确认送检（送检后实验室、送检日期、检测用途锁定且不可撤销） */
export function isSampleSent(sample: Pick<Sample, 'sendDate'>): boolean {
  return Boolean(sample.sendDate)
}

/** 台账中最后一条事件的类型 */
export function lastSampleEvent(sample: Pick<Sample, 'events'>): SampleEvent | null {
  return sample.events.length > 0 ? sample.events[sample.events.length - 1] : null
}

/** 由台账推导当前流转状态 */
export function sampleStatus(sample: Pick<Sample, 'sendDate' | 'events'>): SampleStatus {
  if (!isSampleSent(sample)) return SAMPLE_STATUS.Pending
  const latest = lastSampleEvent(sample)
  if (latest?.type === '收样') return SAMPLE_STATUS.Received
  if (latest?.type === '退样') return SAMPLE_STATUS.Returned
  return SAMPLE_STATUS.Submitted
}

/** 样品号在同一探方内是否重复（大小写、首尾空白不敏感） */
export function isSampleCodeDuplicated(
  samples: Pick<Sample, 'id' | 'trenchId' | 'code'>[],
  candidate: Pick<Sample, 'id' | 'trenchId' | 'code'>
): boolean {
  return samples.some(
    (item) =>
      item.id !== candidate.id &&
      item.trenchId === candidate.trenchId &&
      item.code.trim().toUpperCase() === candidate.code.trim().toUpperCase()
  )
}

function parseDate(value: string): number {
  // 按 UTC 解析 YYYY-MM-DD，避免本地时区造成跨天偏差
  return new Date(`${value}T00:00:00Z`).getTime()
}

/** 今天与指定日期相差的整天数（今天在该日期之前为负） */
export function daysOverdue(expectedDate: string, today = new Date()): number {
  if (!expectedDate) return 0
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.floor((now - parseDate(expectedDate)) / 86400000)
}

/** 催办提醒宽限天数：约定收样日期过后 7 天仍未收样即催办 */
export const SAMPLE_URGE_GRACE_DAYS = 7

/**
 * 是否需要催办：已送检、从未收样且未退样，约定收样日期过 7 天仍在途。
 * 退样视为实验室已有回执，不再催办。
 */
export function isSampleUrged(sample: Pick<Sample, 'sendDate' | 'expectedReceiveDate' | 'events'>, today = new Date()): boolean {
  if (!isSampleSent(sample) || !sample.expectedReceiveDate) return false
  if (sample.events.length > 0) return false
  return daysOverdue(sample.expectedReceiveDate, today) >= SAMPLE_URGE_GRACE_DAYS
}
