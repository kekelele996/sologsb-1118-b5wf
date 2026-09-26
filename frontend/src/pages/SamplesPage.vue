<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { Sample, SampleEvent, SampleEventType, SampleStatus, SampleType, Stratum } from '@/types'
import {
  SAMPLE_TYPES,
  SAMPLE_STATUS,
  SAMPLE_EVENT_TYPES,
  isSampleSent,
  sampleStatus,
  isSampleCodeDuplicated,
  isSampleUrged,
  daysOverdue
} from '@/types'
import StratumDepthBar from '@/components/common/StratumDepthBar.vue'
import UnitPicker from '@/components/common/UnitPicker.vue'
import { useStore } from '@/hooks/usePersistentStore'
import { sampleStore, SampleLockedError } from '@/stores/sampleStore'
import { stratumStore } from '@/stores/stratumStore'
import { trenchStore } from '@/stores/trenchStore'
import { downloadCsv } from '@/utils/export'
import { uid } from '@/utils/id'

const sampleState = useStore(sampleStore)
const stratumState = useStore(stratumStore)
const trenchState = useStore(trenchStore)

const dialogVisible = ref(false)
const editingId = ref<string | null>(null)
const sendTargetId = ref<string | null>(null)
const sendDialogVisible = ref(false)
const eventTargetId = ref<string | null>(null)
const eventDialogVisible = ref(false)

const filterTrenchId = ref('')
const filterType = ref<SampleType | ''>('')
const filterStatus = ref<SampleStatus | ''>('')
const filterUrgedOnly = ref(false)

const today = new Date().toISOString().slice(0, 10)

const form = reactive({
  trenchId: '',
  stratumId: '',
  code: '',
  type: '土样' as SampleType,
  depth: 0.3,
  collectDate: today,
  collector: '',
  quantity: '',
  remark: ''
})

const lockedStratum = computed(
  () => stratumState.strata.find((item) => item.id === form.stratumId && item.trenchId === form.trenchId) ?? null
)

/** 采集深度是否超出所选地层单位范围（保存即失败的硬校验） */
const depthOutOfRange = computed(() => {
  if (!lockedStratum.value) return false
  return form.depth < lockedStratum.value.topDepth || form.depth > lockedStratum.value.bottomDepth
})

/** 同探方内样品号是否重复 */
const codeDuplicated = computed(() => {
  if (!form.code.trim() || !form.trenchId) return false
  return isSampleCodeDuplicated(sampleState.samples, {
    id: editingId.value ?? '',
    trenchId: form.trenchId,
    code: form.code
  })
})

const sendForm = reactive({
  lab: '',
  sendDate: today,
  purpose: '',
  expectedReceiveDate: addDays(today, 7)
})

const eventForm = reactive({
  type: '收样' as SampleEventType,
  date: today,
  handler: '',
  note: ''
})

const sendTarget = computed(() => sampleState.samples.find((item) => item.id === sendTargetId.value) ?? null)
const eventTarget = computed(() => sampleState.samples.find((item) => item.id === eventTargetId.value) ?? null)

watch(
  () => [trenchState.trenches.length, form.trenchId] as const,
  () => {
    if (!form.trenchId && trenchState.trenches.length > 0) {
      form.trenchId = trenchState.trenches[0].id
    }
  },
  { immediate: true }
)

watch(
  () => [stratumState.strata.length, form.trenchId] as const,
  () => {
    const list = stratumState.strata.filter((item) => !form.trenchId || item.trenchId === form.trenchId)
    if (!list.some((item) => item.id === form.stratumId)) {
      form.stratumId = list[0]?.id ?? ''
    }
    if (lockedStratum.value && !editingId.value) {
      form.depth = round2((lockedStratum.value.topDepth + lockedStratum.value.bottomDepth) / 2)
    }
  },
  { immediate: true }
)

/** 新建登记时手动切换单位，带出该单位深度区间的中值；编辑时保留已填深度 */
function onStratumChange(value: string): void {
  form.stratumId = value
  if (editingId.value) return
  const target = stratumState.strata.find((item) => item.id === value && item.trenchId === form.trenchId)
  if (target) {
    form.depth = round2((target.topDepth + target.bottomDepth) / 2)
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function addDays(dateText: string, days: number): string {
  // 与 toISOString 取日期的写法保持同一套 UTC 口径，避免本地时区造成跨天
  const date = new Date(`${dateText}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function stratumOf(stratumId: string): Stratum | undefined {
  return stratumState.strata.find((item) => item.id === stratumId)
}

function trenchLabelOf(trenchId: string): string {
  const trench = trenchState.trenches.find((item) => item.id === trenchId)
  return trench ? `${trench.area} · ${trench.code}` : '未知探方'
}

function statusTagType(status: SampleStatus): 'info' | 'warning' | 'success' | 'danger' | 'primary' {
  switch (status) {
    case SAMPLE_STATUS.Pending:
      return 'info'
    case SAMPLE_STATUS.Submitted:
      return 'warning'
    case SAMPLE_STATUS.Received:
      return 'success'
    case SAMPLE_STATUS.Returned:
      return 'danger'
  }
}

/** 催办：约定收样日期已过 7 天仍在途（无收样 / 退样回执） */
function urgedOf(sample: Sample): boolean {
  return isSampleUrged(sample)
}

function overdueDays(sample: Sample): number {
  return daysOverdue(sample.expectedReceiveDate)
}

const visible = computed(() =>
  sampleState.samples.filter((item) => {
    if (filterTrenchId.value && item.trenchId !== filterTrenchId.value) return false
    if (filterType.value && item.type !== filterType.value) return false
    if (filterStatus.value && sampleStatus(item) !== filterStatus.value) return false
    if (filterUrgedOnly.value && !urgedOf(item)) return false
    return true
  })
)

const urgedSamples = computed(() => sampleState.samples.filter((item) => urgedOf(item)))

function rowClass(param: { row: Sample }): string {
  return urgedOf(param.row) ? 'urge-row' : ''
}

function resetForm(): void {
  editingId.value = null
  form.trenchId = trenchState.trenches[0]?.id ?? ''
  const first = stratumState.strata.find((item) => item.trenchId === form.trenchId)
  form.stratumId = first?.id ?? ''
  form.code = ''
  form.type = '土样'
  form.depth = first ? round2((first.topDepth + first.bottomDepth) / 2) : 0.3
  form.collectDate = today
  form.collector = ''
  form.quantity = ''
  form.remark = ''
}

function openCreate(): void {
  resetForm()
  dialogVisible.value = true
}

function openEdit(sample: Sample): void {
  if (isSampleSent(sample)) {
    ElMessage.warning('该样品已确认送检，登记信息已锁定，只能追加收样 / 退样记录')
    return
  }
  editingId.value = sample.id
  Object.assign(form, {
    trenchId: sample.trenchId,
    stratumId: sample.stratumId,
    code: sample.code,
    type: sample.type,
    depth: sample.depth,
    collectDate: sample.collectDate,
    collector: sample.collector,
    quantity: sample.quantity,
    remark: sample.remark
  })
  dialogVisible.value = true
}

async function submit(): Promise<void> {
  if (!lockedStratum.value) {
    ElMessage.warning('请先选择所属探方与地层单位')
    return
  }
  if (!form.code.trim()) {
    ElMessage.warning('请填写样品号')
    return
  }
  if (codeDuplicated.value) {
    ElMessage.error(`探方「${trenchLabelOf(form.trenchId)}」内样品号「${form.code.trim()}」已存在，请更换`)
    return
  }
  if (depthOutOfRange.value) {
    ElMessage.error(
      `采集深度 ${form.depth} m 超出单位「${lockedStratum.value.code}」的深度范围（${lockedStratum.value.topDepth}–${lockedStratum.value.bottomDepth} m），保存失败，请核对层位后重试`
    )
    return
  }
  const row: Sample = {
    id: editingId.value ?? uid('sp'),
    code: form.code.trim(),
    trenchId: form.trenchId,
    stratumId: lockedStratum.value.id,
    type: form.type,
    depth: round2(Number(form.depth) || 0),
    collectDate: form.collectDate,
    collector: form.collector.trim(),
    quantity: form.quantity.trim(),
    remark: form.remark.trim(),
    lab: '',
    sendDate: '',
    purpose: '',
    expectedReceiveDate: '',
    events: []
  }
  try {
    await sampleStore.getState().save(row)
  } catch (error) {
    ElMessage.error(error instanceof SampleLockedError ? error.message : '样品保存失败')
    return
  }
  ElMessage.success(`样品 ${row.code} 已登记，送检前可继续修改`)
  dialogVisible.value = false
}

async function remove(sample: Sample): Promise<void> {
  if (isSampleSent(sample)) {
    ElMessage.error('已送检记录不可撤销，不能删除')
    return
  }
  await ElMessageBox.confirm(`确认删除待送检样品「${sample.code}」？送检前删除不保留台账。`, '删除确认', {
    type: 'warning'
  })
  try {
    await sampleStore.getState().remove(sample.id)
  } catch (error) {
    ElMessage.error(error instanceof SampleLockedError ? error.message : '删除失败')
    return
  }
  ElMessage.success('待送检样品已删除')
}

function openSend(sample: Sample): void {
  if (isSampleSent(sample)) {
    ElMessage.warning('该样品已送检，不能重复送检')
    return
  }
  sendTargetId.value = sample.id
  Object.assign(sendForm, {
    lab: '',
    sendDate: today,
    purpose: '',
    expectedReceiveDate: addDays(today, 7)
  })
  sendDialogVisible.value = true
}

async function submitSend(): Promise<void> {
  if (!sendTarget.value) return
  if (!sendForm.lab.trim()) {
    ElMessage.warning('请填写送检实验室')
    return
  }
  if (!sendForm.sendDate) {
    ElMessage.warning('请选择送检日期')
    return
  }
  if (!sendForm.purpose.trim()) {
    ElMessage.warning('请填写检测用途')
    return
  }
  if (!sendForm.expectedReceiveDate) {
    ElMessage.warning('请填写与实验室约定的收样日期，用于到期催办')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确认把样品「${sendTarget.value.code}」送检至「${sendForm.lab.trim()}」？送检后实验室、送检日期与检测用途将锁定，记录不可撤销。`,
      '确认送检',
      { type: 'warning', confirmButtonText: '确认送检' }
    )
  } catch {
    return
  }
  try {
    await sampleStore.getState().confirmSend(sendTarget.value.id, { ...sendForm })
  } catch (error) {
    ElMessage.error(error instanceof SampleLockedError ? error.message : '送检失败')
    return
  }
  ElMessage.success(`样品 ${sendTarget.value.code} 已送检，台账锁定`)
  sendTargetId.value = null
  sendDialogVisible.value = false
}

function openEvent(sample: Sample, type: SampleEventType): void {
  if (!isSampleSent(sample)) {
    ElMessage.warning('样品尚未送检')
    return
  }
  eventTargetId.value = sample.id
  Object.assign(eventForm, { type, date: today, handler: '', note: '' })
  eventDialogVisible.value = true
}

async function submitEvent(): Promise<void> {
  if (!eventTarget.value) return
  if (!eventForm.date) {
    ElMessage.warning('请选择日期')
    return
  }
  if (!eventForm.handler.trim()) {
    ElMessage.warning('请填写经手人')
    return
  }
  const event: SampleEvent = {
    id: uid('se'),
    type: eventForm.type,
    date: eventForm.date,
    handler: eventForm.handler.trim(),
    note: eventForm.note.trim()
  }
  try {
    await sampleStore.getState().appendEvent(eventTarget.value.id, event)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '台账追加失败')
    return
  }
  ElMessage.success(`已为 ${eventTarget.value.code} 追加${eventForm.type}记录`)
  eventTargetId.value = null
  eventDialogVisible.value = false
}

/** 收样登记一次即可；退样之后允许重新登记收样（实验室补录） */
function canReceive(sample: Sample): boolean {
  const latest = sample.events[sample.events.length - 1]
  return !latest || latest.type === '退样'
}

/** 未登记收样可直接退样（拒收）；收样之后也可退样；最近一条已是退样则不可重复退样 */
function canReturn(sample: Sample): boolean {
  const latest = sample.events[sample.events.length - 1]
  return !latest || latest.type === '收样'
}

function eventTagType(type: SampleEventType): 'success' | 'danger' {
  return type === '收样' ? 'success' : 'danger'
}

function exportList(): void {
  downloadCsv(
    '样品送检台账.csv',
    visible.value.map((item) => {
      const unit = stratumOf(item.stratumId)
      const latest = item.events[item.events.length - 1]
      return {
        code: item.code,
        trench: trenchLabelOf(item.trenchId),
        stratum: unit?.code ?? '未知单位',
        type: item.type,
        depth: item.depth,
        quantity: item.quantity,
        collectDate: item.collectDate,
        collector: item.collector,
        status: sampleStatus(item),
        lab: item.lab,
        sendDate: item.sendDate,
        purpose: item.purpose,
        expectedReceiveDate: item.expectedReceiveDate,
        latestEvent: latest ? `${latest.type} ${latest.date}` : '',
        remark: item.remark
      }
    }) as unknown as Record<string, unknown>[],
    [
      { key: 'code', label: '样品号' },
      { key: 'trench', label: '探方' },
      { key: 'stratum', label: '地层单位' },
      { key: 'type', label: '种类' },
      { key: 'depth', label: '采集深度(m)' },
      { key: 'quantity', label: '数量/规格' },
      { key: 'collectDate', label: '采集日期' },
      { key: 'collector', label: '采集人' },
      { key: 'status', label: '状态' },
      { key: 'lab', label: '送检实验室' },
      { key: 'sendDate', label: '送检日期' },
      { key: 'purpose', label: '检测用途' },
      { key: 'expectedReceiveDate', label: '约定收样日期' },
      { key: 'latestEvent', label: '最近回执' },
      { key: 'remark', label: '备注' }
    ]
  )
  ElMessage.success('样品送检台账已导出')
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h2 class="page-title">样品送检台账</h2>
        <p class="page-sub">
          样品从已有探方与地层单位中选取登记，采集深度必须落在单位深度范围内、同一探方内样品号唯一；确认送检后实验室、送检日期与检测用途锁定不可撤销，后续只能追加收样 / 退样记录。约定收样日期过后 7 天仍未收样自动催办。
        </p>
      </div>
      <div class="head-actions">
        <el-button @click="exportList">导出台账</el-button>
        <el-button type="primary" @click="openCreate">
          <el-icon><Plus /></el-icon>登记样品
        </el-button>
      </div>
    </div>

    <el-alert
      v-if="urgedSamples.length > 0"
      class="alert"
      type="error"
      show-icon
      :closable="false"
      :title="`${urgedSamples.length} 件样品已超过约定收样日期 7 天仍未收样，请催办实验室`"
    >
      <template #default>
        <span v-for="(item, index) in urgedSamples" :key="item.id">
          <el-button link type="danger" size="small" @click="filterTrenchId = item.trenchId; filterUrgedOnly = true">
            {{ item.code }}
          </el-button>
          <span class="muted">（{{ trenchLabelOf(item.trenchId) }} · {{ stratumOf(item.stratumId)?.code }} · 已超期 {{ overdueDays(item) }} 天）</span><span v-if="index < urgedSamples.length - 1">；</span>
        </span>
      </template>
    </el-alert>

    <div class="toolbar">
      <el-select v-model="filterTrenchId" placeholder="全部探方" clearable style="width: 190px">
        <el-option v-for="trench in trenchState.trenches" :key="trench.id" :label="`${trench.area} · ${trench.code}`" :value="trench.id" />
      </el-select>
      <el-select v-model="filterType" placeholder="全部种类" clearable style="width: 130px">
        <el-option v-for="item in SAMPLE_TYPES" :key="item" :label="item" :value="item" />
      </el-select>
      <el-select v-model="filterStatus" placeholder="全部状态" clearable style="width: 130px">
        <el-option v-for="item in Object.values(SAMPLE_STATUS)" :key="item" :label="item" :value="item" />
      </el-select>
      <el-checkbox v-model="filterUrgedOnly" border>只看催办</el-checkbox>
      <el-tag type="info" effect="plain">命中 {{ visible.length }} / {{ sampleState.samples.length }} 件</el-tag>
    </div>

    <el-table :data="visible" border stripe row-key="id" :row-class-name="rowClass">
      <el-table-column prop="code" label="样品号" width="130" />
      <el-table-column label="探方 / 单位" width="190">
        <template #default="{ row }: { row: Sample }">
          <div class="mono">{{ trenchLabelOf(row.trenchId) }}</div>
          <div class="muted">单位 {{ stratumOf(row.stratumId)?.code ?? '未知单位' }}</div>
        </template>
      </el-table-column>
      <el-table-column label="单位深度范围" width="230">
        <template #default="{ row }: { row: Sample }">
          <StratumDepthBar v-if="stratumOf(row.stratumId)" :stratum="stratumOf(row.stratumId)!" :length="160" :show-thickness="false" />
          <div v-if="stratumOf(row.stratumId)" class="muted">采集深度 {{ row.depth }} m</div>
        </template>
      </el-table-column>
      <el-table-column label="种类" width="80">
        <template #default="{ row }: { row: Sample }">
          <el-tag size="small" effect="plain">{{ row.type }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="quantity" label="数量/规格" width="110" show-overflow-tooltip>
        <template #default="{ row }: { row: Sample }">{{ row.quantity || '—' }}</template>
      </el-table-column>
      <el-table-column prop="collectDate" label="采集日期" width="110" />
      <el-table-column label="状态 / 催办" width="190">
        <template #default="{ row }: { row: Sample }">
          <el-tag :type="statusTagType(sampleStatus(row))" size="small" effect="dark">{{ sampleStatus(row) }}</el-tag>
          <div v-if="urgedOf(row)" class="urge">
            <el-icon><WarningFilled /></el-icon>
            超约定收样日 {{ overdueDays(row) }} 天，请催办
          </div>
        </template>
      </el-table-column>
      <el-table-column label="送检信息" min-width="220" show-overflow-tooltip>
        <template #default="{ row }: { row: Sample }">
          <template v-if="isSampleSent(row)">
            <div>{{ row.lab }}</div>
            <div class="muted">
              {{ row.sendDate }} 送检 · {{ row.purpose }}
            </div>
            <div class="muted">约定收样：{{ row.expectedReceiveDate || '—' }}</div>
          </template>
          <span v-else class="muted">尚未送检</span>
        </template>
      </el-table-column>
      <el-table-column label="收样 / 退样台账" width="170">
        <template #default="{ row }: { row: Sample }">
          <el-popover v-if="row.events.length > 0" placement="left" :width="320" trigger="click">
            <template #reference>
              <el-button link type="primary" size="small">
                台账 {{ row.events.length }} 条
                <el-icon><ArrowRight /></el-icon>
              </el-button>
            </template>
            <el-timeline class="timeline">
              <el-timeline-item
                v-for="eventItem in row.events"
                :key="eventItem.id"
                :type="eventTagType(eventItem.type)"
                :timestamp="`${eventItem.date} · ${eventItem.handler}`"
              >
                <el-tag :type="eventTagType(eventItem.type)" size="small" effect="dark">{{ eventItem.type }}</el-tag>
                <p v-if="eventItem.note" class="event-note">{{ eventItem.note }}</p>
              </el-timeline-item>
            </el-timeline>
          </el-popover>
          <span v-else class="muted">无回执</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="230" fixed="right">
        <template #default="{ row }: { row: Sample }">
          <template v-if="!isSampleSent(row)">
            <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
            <el-button link type="success" size="small" @click="openSend(row)">确认送检</el-button>
            <el-button link type="danger" size="small" @click="remove(row)">删除</el-button>
          </template>
          <template v-else>
            <el-button link type="success" size="small" :disabled="!canReceive(row)" @click="openEvent(row, '收样')">
              收样
            </el-button>
            <el-button link type="warning" size="small" :disabled="!canReturn(row)" @click="openEvent(row, '退样')">退样</el-button>
            <el-tooltip content="已送检记录不可撤销，只能追加收样 / 退样记录" placement="top">
              <span class="locked-hint">已锁定</span>
            </el-tooltip>
          </template>
        </template>
      </el-table-column>
    </el-table>

    <!-- 登记 / 编辑（仅待送检） -->
    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑样品（送检前可修改）' : '登记送检样品'" width="720px">
      <UnitPicker
        v-model="form.stratumId"
        v-model:trench-id="form.trenchId"
        :trenches="trenchState.trenches"
        :strata="stratumState.strata"
        @update:model-value="onStratumChange"
      />
      <div v-if="lockedStratum" class="locked">
        <StratumDepthBar :stratum="lockedStratum" :length="240" />
      </div>
      <el-form label-width="110px" class="sample-form">
        <el-row :gutter="12">
          <el-col :span="8">
            <el-form-item label="样品号" required>
              <el-input v-model="form.code" placeholder="如 T0501-C01" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="样品种类">
              <el-select v-model="form.type" style="width: 100%">
                <el-option v-for="item in SAMPLE_TYPES" :key="item" :label="item" :value="item" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="采集深度(m)" required>
              <el-input-number v-model="form.depth" :min="0" :max="10" :step="0.01" :precision="2" :controls="false" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="采集日期">
              <el-date-picker v-model="form.collectDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="采集人">
              <el-input v-model="form.collector" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="数量/规格">
              <el-input v-model="form.quantity" placeholder="如 500g、2 袋" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="备注">
          <el-input v-model="form.remark" type="textarea" :rows="2" placeholder="采样位置、包装与拟检项目等" />
        </el-form-item>
      </el-form>
      <div v-if="depthOutOfRange" class="form-warn">
        <el-icon><WarningFilled /></el-icon>
        采集深度 {{ form.depth }} m 超出「{{ lockedStratum?.code }}」范围（{{ lockedStratum?.topDepth }}–{{ lockedStratum?.bottomDepth }}
        m），保存将失败
      </div>
      <div v-if="codeDuplicated" class="form-warn">
        <el-icon><WarningFilled /></el-icon>
        探方内样品号「{{ form.code }}」已存在，保存将失败
      </div>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submit">{{ editingId ? '保存修改' : '登记样品' }}</el-button>
      </template>
    </el-dialog>

    <!-- 确认送检 -->
    <el-dialog v-model="sendDialogVisible" title="确认送检（提交后锁定，不可撤销）" width="560px">
      <el-alert
        v-if="sendTarget"
        type="info"
        :closable="false"
        class="alert"
        :title="`样品 ${sendTarget.code} · ${trenchLabelOf(sendTarget.trenchId)} · 单位 ${stratumOf(sendTarget.stratumId)?.code}`"
        :description="`${sendTarget.type} · 采集深度 ${sendTarget.depth} m · ${sendTarget.quantity || '规格未填'}`"
      />
      <el-form label-width="120px">
        <el-form-item label="送检实验室" required>
          <el-input v-model="sendForm.lab" placeholder="如 省文物考古研究院科技考古室" />
        </el-form-item>
        <el-form-item label="送检日期" required>
          <el-date-picker v-model="sendForm.sendDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
        <el-form-item label="检测用途" required>
          <el-input v-model="sendForm.purpose" placeholder="如 碳十四测年、孢粉分析" />
        </el-form-item>
        <el-form-item label="约定收样日期" required>
          <el-date-picker v-model="sendForm.expectedReceiveDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
        <p class="muted">超过约定收样日期 7 天仍未登记收样，列表将自动给出催办提醒。</p>
      </el-form>
      <template #footer>
        <el-button @click="sendDialogVisible = false">取消</el-button>
        <el-button type="warning" @click="submitSend">确认送检并锁定</el-button>
      </template>
    </el-dialog>

    <!-- 追加收样 / 退样 -->
    <el-dialog v-model="eventDialogVisible" :title="`追加${eventForm.type}记录`" width="520px">
      <el-alert
        v-if="eventTarget"
        :type="eventForm.type === '收样' ? 'success' : 'warning'"
        :closable="false"
        class="alert"
        :title="`样品 ${eventTarget.code} · ${eventTarget.lab}`"
        :description="`送检日期 ${eventTarget.sendDate} · ${eventTarget.purpose}`"
      />
      <el-form label-width="90px">
        <el-form-item label="记录类型">
          <el-radio-group v-model="eventForm.type">
            <el-radio v-for="item in SAMPLE_EVENT_TYPES" :key="item" :value="item">{{ item }}</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="日期" required>
          <el-date-picker v-model="eventForm.date" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
        <el-form-item label="经手人" required>
          <el-input v-model="eventForm.handler" placeholder="实验室收样人 / 退样经办人" />
        </el-form-item>
        <el-form-item label="说明">
          <el-input v-model="eventForm.note" type="textarea" :rows="3" :placeholder="eventForm.type === '收样' ? '包装与标签情况、入库编号等' : '退样原因、样品状态等'" />
        </el-form-item>
        <p class="muted">台账记录只可追加，已送检的登记信息不可修改或撤销。</p>
      </el-form>
      <template #footer>
        <el-button @click="eventDialogVisible = false">取消</el-button>
        <el-button :type="eventForm.type === '收样' ? 'success' : 'warning'" @click="submitEvent">
          追加{{ eventForm.type }}记录
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.head-actions {
  display: flex;
  gap: 8px;
}
.alert {
  margin-bottom: 14px;
}
.locked {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin: 10px 0;
  padding: 8px 12px;
  border-radius: 8px;
  background: #f7f4ee;
}
.sample-form {
  margin-top: 12px;
}
.form-warn {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  color: #c0392b;
  font-size: 12px;
}
.urge {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
  color: #c0392b;
  font-size: 12px;
}
.locked-hint {
  font-size: 12px;
  color: #8a8073;
  cursor: help;
}
.event-note {
  margin: 4px 0 0;
  font-size: 12px;
  color: #5d5346;
}
.timeline {
  padding: 8px 0 0 4px;
}
:deep(.urge-row) {
  background: #fdf2f2 !important;
}
</style>
