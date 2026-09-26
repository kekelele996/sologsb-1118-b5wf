<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { Sample, SampleLogType, SampleStatus, SampleType, TestPurpose } from '@/types'
import {
  SAMPLE_GRACE_DAYS,
  SAMPLE_LOG_TYPES,
  SAMPLE_TYPES,
  TEST_PURPOSES,
  daysPastDue,
  isDepthOutOfRange,
  isSampleCodeDuplicated,
  isSampleOverdue,
  sampleStatus
} from '@/types'
import StratumDepthBar from '@/components/common/StratumDepthBar.vue'
import UnitPicker from '@/components/common/UnitPicker.vue'
import { useStore } from '@/hooks/usePersistentStore'
import { sampleStore } from '@/stores/sampleStore'
import { stratumStore } from '@/stores/stratumStore'
import { trenchStore } from '@/stores/trenchStore'
import { downloadCsv } from '@/utils/export'
import { uid } from '@/utils/id'

const sampleState = useStore(sampleStore)
const stratumState = useStore(stratumStore)
const trenchState = useStore(trenchStore)

const today = new Date().toISOString().slice(0, 10)

const pickTrenchId = ref('')
const pickStratumId = ref('')
const filterTrenchId = ref('')
const filterStatus = ref<SampleStatus | ''>('')
const filterType = ref<SampleType | ''>('')
const onlyOverdue = ref(false)
const editingId = ref<string | null>(null)

const form = reactive({
  code: '',
  type: '土样' as SampleType,
  depth: 0.5,
  collectDate: today,
  collector: '',
  note: ''
})

const submitDialogVisible = ref(false)
const submitTarget = ref<Sample | null>(null)
const submitForm = reactive({
  lab: '',
  submitDate: today,
  purpose: '' as TestPurpose | '',
  dueDate: ''
})

const logDialogVisible = ref(false)
const logTarget = ref<Sample | null>(null)
const logForm = reactive({
  type: '收样' as SampleLogType,
  date: today,
  operator: '',
  note: ''
})

const STATUS_TAG: Record<SampleStatus, 'info' | 'warning' | 'success' | 'danger'> = {
  待送检: 'info',
  已送检: 'warning',
  已收样: 'success',
  已退样: 'danger'
}

const lockedStratum = computed(() => stratumState.strata.find((item) => item.id === pickStratumId.value) ?? null)

watch(
  () => [trenchState.trenches.length, pickTrenchId.value] as const,
  () => {
    if (!pickTrenchId.value && trenchState.trenches.length > 0) {
      pickTrenchId.value = trenchState.trenches[0].id
    }
  },
  { immediate: true }
)

watch(
  () => [stratumState.strata.length, pickTrenchId.value] as const,
  () => {
    const list = stratumState.strata.filter((item) => !pickTrenchId.value || item.trenchId === pickTrenchId.value)
    if (!list.some((item) => item.id === pickStratumId.value)) {
      pickStratumId.value = list[0]?.id ?? ''
    }
    if (lockedStratum.value && !editingId.value) {
      form.depth = Math.round(((lockedStratum.value.topDepth + lockedStratum.value.bottomDepth) / 2) * 100) / 100
    }
  },
  { immediate: true }
)

function stratumOf(stratumId: string): string {
  return stratumState.strata.find((item) => item.id === stratumId)?.code ?? '未知单位'
}

function trenchOf(stratumId: string): string {
  const stratum = stratumState.strata.find((item) => item.id === stratumId)
  if (!stratum) return '未知探方'
  const trench = trenchState.trenches.find((item) => item.id === stratum.trenchId)
  return trench ? `${trench.area} · ${trench.code}` : '未知探方'
}

/** 采集深度是否落在当前地层单位区间内（单位后被改动时用于列表复核） */
function depthOutOf(sample: Sample): boolean {
  const stratum = stratumState.strata.find((item) => item.id === sample.stratumId)
  return stratum ? isDepthOutOfRange(stratum, sample.depth) : false
}

const visible = computed(() =>
  sampleState.samples.filter((item) => {
    if (filterType.value && item.type !== filterType.value) return false
    if (filterStatus.value && sampleStatus(item) !== filterStatus.value) return false
    if (onlyOverdue.value && !isSampleOverdue(item)) return false
    if (filterTrenchId.value) {
      const stratum = stratumState.strata.find((row) => row.id === item.stratumId)
      if (!stratum || stratum.trenchId !== filterTrenchId.value) return false
    }
    return true
  })
)

const overdueList = computed(() => sampleState.samples.filter((item) => isSampleOverdue(item)))

function canReceive(sample: Sample): boolean {
  return sampleStatus(sample) === '已送检'
}

function canReturn(sample: Sample): boolean {
  const status = sampleStatus(sample)
  return status === '已送检' || status === '已收样'
}

function resetForm(): void {
  editingId.value = null
  form.code = ''
  form.type = '土样'
  form.collectDate = today
  form.collector = ''
  form.note = ''
  if (lockedStratum.value) {
    form.depth = Math.round(((lockedStratum.value.topDepth + lockedStratum.value.bottomDepth) / 2) * 100) / 100
  }
}

function openEdit(sample: Sample): void {
  if (sampleStatus(sample) !== '待送检') {
    ElMessage.warning(`样品「${sample.code}」已送检，基本信息不可再修改，只能追加收样/退样记录`)
    return
  }
  editingId.value = sample.id
  const stratum = stratumState.strata.find((item) => item.id === sample.stratumId)
  if (stratum) {
    pickTrenchId.value = stratum.trenchId
    pickStratumId.value = stratum.id
  }
  Object.assign(form, {
    code: sample.code,
    type: sample.type,
    depth: sample.depth,
    collectDate: sample.collectDate,
    collector: sample.collector,
    note: sample.note
  })
}

async function submit(): Promise<void> {
  if (!lockedStratum.value) {
    ElMessage.warning('请先选择所属地层单位')
    return
  }
  if (!form.code.trim()) {
    ElMessage.warning('请填写样品号')
    return
  }
  const candidate = { id: editingId.value ?? uid('sp'), stratumId: lockedStratum.value.id, code: form.code }
  if (isSampleCodeDuplicated(sampleState.samples, stratumState.strata, candidate)) {
    ElMessage.error(`保存失败：本探方内样品号「${form.code.trim()}」已存在`)
    return
  }
  if (isDepthOutOfRange(lockedStratum.value, Number(form.depth))) {
    ElMessage.error(
      `保存失败：采集深度 ${form.depth} m 超出单位「${lockedStratum.value.code}」的深度区间（${lockedStratum.value.topDepth}–${lockedStratum.value.bottomDepth} m）`
    )
    return
  }
  const previous = editingId.value ? sampleState.samples.find((item) => item.id === editingId.value) : undefined
  const row: Sample = {
    id: candidate.id,
    stratumId: lockedStratum.value.id,
    code: candidate.code.trim().toUpperCase(),
    type: form.type,
    depth: Number(form.depth) || 0,
    collectDate: form.collectDate,
    collector: form.collector.trim(),
    lab: previous?.lab ?? '',
    purpose: previous?.purpose ?? '',
    submitDate: previous?.submitDate ?? '',
    dueDate: previous?.dueDate ?? '',
    logs: previous ? [...previous.logs] : [],
    note: form.note.trim()
  }
  await sampleStore.getState().save(row)
  ElMessage.success(`样品 ${row.code} 已登记到 ${lockedStratum.value.code}，待确认送检`)
  resetForm()
}

function openSubmit(sample: Sample): void {
  if (sampleStatus(sample) !== '待送检') {
    ElMessage.warning(`样品「${sample.code}」已送检，实验室、送检日期与检测用途已锁定`)
    return
  }
  submitTarget.value = sample
  Object.assign(submitForm, { lab: '', submitDate: today, purpose: '', dueDate: '' })
  submitDialogVisible.value = true
}

async function confirmSubmit(): Promise<void> {
  const sample = submitTarget.value
  if (!sample) return
  if (!submitForm.lab.trim()) {
    ElMessage.warning('请填写送检实验室')
    return
  }
  if (!submitForm.submitDate) {
    ElMessage.warning('请选择送检日期')
    return
  }
  if (!submitForm.purpose) {
    ElMessage.warning('请选择检测用途')
    return
  }
  if (!submitForm.dueDate) {
    ElMessage.warning('请选择约定收样日期')
    return
  }
  if (submitForm.dueDate < submitForm.submitDate) {
    ElMessage.warning('约定收样日期不能早于送检日期')
    return
  }
  await sampleStore.getState().save({
    ...sample,
    lab: submitForm.lab.trim(),
    submitDate: submitForm.submitDate,
    purpose: submitForm.purpose,
    dueDate: submitForm.dueDate
  })
  ElMessage.success(`样品 ${sample.code} 已确认送检，送检信息已锁定`)
  submitDialogVisible.value = false
  submitTarget.value = null
}

function openLog(sample: Sample, type: SampleLogType): void {
  if (type === '收样' && !canReceive(sample)) {
    ElMessage.warning('仅「已送检」且尚未收样的样品可以登记收样')
    return
  }
  if (type === '退样' && !canReturn(sample)) {
    ElMessage.warning('仅「已送检 / 已收样」的样品可以登记退样')
    return
  }
  logTarget.value = sample
  Object.assign(logForm, { type, date: today, operator: '', note: '' })
  logDialogVisible.value = true
}

async function confirmLog(): Promise<void> {
  const sample = logTarget.value
  if (!sample) return
  if (!logForm.date) {
    ElMessage.warning('请选择日期')
    return
  }
  if (!logForm.operator.trim()) {
    ElMessage.warning('请填写经办人')
    return
  }
  await sampleStore.getState().save({
    ...sample,
    logs: [
      ...sample.logs,
      { id: uid('sl'), type: logForm.type, date: logForm.date, operator: logForm.operator.trim(), note: logForm.note.trim() }
    ]
  })
  ElMessage.success(`样品 ${sample.code} 已追加「${logForm.type}」记录`)
  logDialogVisible.value = false
  logTarget.value = null
}

async function remove(sample: Sample): Promise<void> {
  if (sampleStatus(sample) !== '待送检') {
    ElMessage.error(`样品「${sample.code}」已送检，不能撤销；如样品退回请追加退样记录`)
    return
  }
  await ElMessageBox.confirm(`确认删除待送检样品「${sample.code}」？`, '删除确认', { type: 'warning' })
  await sampleStore.getState().remove(sample.id)
  ElMessage.success('样品记录已删除')
  if (editingId.value === sample.id) resetForm()
}

function exportList(): void {
  downloadCsv(
    '样品送检台账.csv',
    visible.value.map((item) => ({
      code: item.code,
      trench: trenchOf(item.stratumId),
      stratum: stratumOf(item.stratumId),
      type: item.type,
      depth: item.depth,
      collectDate: item.collectDate,
      collector: item.collector,
      status: sampleStatus(item),
      lab: item.lab,
      purpose: item.purpose,
      submitDate: item.submitDate,
      dueDate: item.dueDate,
      logs: item.logs.map((log) => `${log.date} ${log.type}（${log.operator}）`).join('；'),
      note: item.note
    })) as unknown as Record<string, unknown>[],
    [
      { key: 'code', label: '样品号' },
      { key: 'trench', label: '探方' },
      { key: 'stratum', label: '地层单位' },
      { key: 'type', label: '样品类型' },
      { key: 'depth', label: '采集深度(m)' },
      { key: 'collectDate', label: '采集日期' },
      { key: 'collector', label: '采集人' },
      { key: 'status', label: '状态' },
      { key: 'lab', label: '实验室' },
      { key: 'purpose', label: '检测用途' },
      { key: 'submitDate', label: '送检日期' },
      { key: 'dueDate', label: '约定收样日期' },
      { key: 'logs', label: '收退样记录' },
      { key: 'note', label: '备注' }
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
          土样、炭样等样品从已有探方与地层单位中选取，采集深度超出单位区间或样品号在探方内重复时保存失败；
          确认送检后实验室、送检日期与检测用途锁定，仅可追加收样/退样记录，已送检记录不可撤销。
        </p>
      </div>
      <el-button @click="exportList">导出台账</el-button>
    </div>

    <el-alert
      v-if="overdueList.length > 0"
      class="alert"
      type="error"
      :closable="false"
      show-icon
      :title="`${overdueList.length} 份样品已过约定收样日 ${SAMPLE_GRACE_DAYS} 天仍未收样，请催办`"
    >
      <template #default>
        <p v-for="item in overdueList" :key="item.id" class="overdue-line">
          {{ item.code }}（{{ trenchOf(item.stratumId) }} · {{ stratumOf(item.stratumId) }}）送检于 {{ item.submitDate }}，
          约定 {{ item.dueDate }} 收样，已超约定 {{ daysPastDue(item) }} 天 —— 请催办 {{ item.lab }}
        </p>
      </template>
    </el-alert>

    <el-card shadow="never" class="form-card">
      <template #header>{{ editingId ? `编辑待送检样品（${form.code}）` : '登记样品（送检前可修改）' }}</template>
      <UnitPicker
        v-model="pickStratumId"
        v-model:trench-id="pickTrenchId"
        :trenches="trenchState.trenches"
        :strata="stratumState.strata"
      />
      <div v-if="lockedStratum" class="locked">
        <StratumDepthBar :stratum="lockedStratum" :length="240" />
        <span class="muted">采集深度须落在 {{ lockedStratum.topDepth }}–{{ lockedStratum.bottomDepth }} m 区间内，否则保存失败</span>
      </div>
      <el-form label-width="100px" class="form">
        <el-row :gutter="12">
          <el-col :span="8">
            <el-form-item label="样品号" required>
              <el-input v-model="form.code" placeholder="如 T0501H12-炭01" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="样品类型">
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
          <el-col :span="24">
            <el-form-item label="备注">
              <el-input v-model="form.note" placeholder="如 采样位置、拟检测方向" />
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
      <div class="actions">
        <el-button type="primary" @click="submit">{{ editingId ? '保存修改' : '登记样品' }}</el-button>
        <el-button v-if="editingId" @click="resetForm">取消编辑</el-button>
      </div>
    </el-card>

    <div class="toolbar">
      <el-select v-model="filterTrenchId" placeholder="全部探方" clearable style="width: 190px">
        <el-option v-for="trench in trenchState.trenches" :key="trench.id" :label="`${trench.area} · ${trench.code}`" :value="trench.id" />
      </el-select>
      <el-select v-model="filterType" placeholder="全部类型" clearable style="width: 130px">
        <el-option v-for="item in SAMPLE_TYPES" :key="item" :label="item" :value="item" />
      </el-select>
      <el-select v-model="filterStatus" placeholder="全部状态" clearable style="width: 130px">
        <el-option v-for="item in ['待送检', '已送检', '已收样', '已退样']" :key="item" :label="item" :value="item" />
      </el-select>
      <el-checkbox v-model="onlyOverdue">仅看催办</el-checkbox>
      <el-tag type="info" effect="plain">命中 {{ visible.length }} / {{ sampleState.samples.length }} 份样品</el-tag>
      <el-tag v-if="overdueList.length > 0" type="danger" effect="dark">催办 {{ overdueList.length }} 份</el-tag>
    </div>

    <el-table :data="visible" border stripe row-key="id">
      <el-table-column type="expand">
        <template #default="{ row }: { row: Sample }">
          <div class="expand">
            <p class="muted">
              送检信息：
              <template v-if="row.submitDate">
                {{ row.lab }} · {{ row.submitDate }} 送检 · 用途「{{ row.purpose }}」 · 约定 {{ row.dueDate }} 收样（已锁定）
              </template>
              <template v-else>尚未送检，确认送检后实验室、送检日期与检测用途即锁定</template>
            </p>
            <p v-if="row.note" class="muted">备注：{{ row.note }}</p>
            <el-timeline v-if="row.logs.length > 0" class="timeline">
              <el-timeline-item
                v-for="log in row.logs"
                :key="log.id"
                :timestamp="`${log.date} · 经办 ${log.operator}`"
                :type="log.type === '收样' ? 'success' : 'warning'"
              >
                {{ log.type }}<span v-if="log.note"> — {{ log.note }}</span>
              </el-timeline-item>
            </el-timeline>
            <p v-else class="muted">暂无收样/退样记录</p>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="样品号" width="160">
        <template #default="{ row }: { row: Sample }">
          <span class="mono">{{ row.code }}</span>
        </template>
      </el-table-column>
      <el-table-column label="探方" width="140">
        <template #default="{ row }: { row: Sample }">
          <span class="mono">{{ trenchOf(row.stratumId) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="地层单位" width="100">
        <template #default="{ row }: { row: Sample }">
          <span class="mono">{{ stratumOf(row.stratumId) }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="type" label="类型" width="90" />
      <el-table-column label="采集深度" width="120">
        <template #default="{ row }: { row: Sample }">
          {{ row.depth }} m
          <el-tag v-if="depthOutOf(row)" type="danger" size="small" effect="dark" class="mini">越界</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{ row }: { row: Sample }">
          <el-tag :type="STATUS_TAG[sampleStatus(row)]" size="small" effect="plain">{{ sampleStatus(row) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="实验室" min-width="170" show-overflow-tooltip>
        <template #default="{ row }: { row: Sample }">{{ row.lab || '—' }}</template>
      </el-table-column>
      <el-table-column label="检测用途" width="110">
        <template #default="{ row }: { row: Sample }">{{ row.purpose || '—' }}</template>
      </el-table-column>
      <el-table-column label="送检日期" width="110">
        <template #default="{ row }: { row: Sample }">{{ row.submitDate || '—' }}</template>
      </el-table-column>
      <el-table-column label="约定收样" width="110">
        <template #default="{ row }: { row: Sample }">{{ row.dueDate || '—' }}</template>
      </el-table-column>
      <el-table-column label="催办" width="150">
        <template #default="{ row }: { row: Sample }">
          <el-tag v-if="isSampleOverdue(row)" type="danger" effect="dark" size="small">
            催办 · 超约定 {{ daysPastDue(row) }} 天
          </el-tag>
          <span v-else class="muted">—</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="220" fixed="right">
        <template #default="{ row }: { row: Sample }">
          <template v-if="sampleStatus(row) === '待送检'">
            <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
            <el-button link type="warning" size="small" @click="openSubmit(row)">确认送检</el-button>
            <el-button link type="danger" size="small" @click="remove(row)">删除</el-button>
          </template>
          <template v-else>
            <el-button v-if="canReceive(row)" link type="success" size="small" @click="openLog(row, '收样')">收样</el-button>
            <el-button v-if="canReturn(row)" link type="warning" size="small" @click="openLog(row, '退样')">退样</el-button>
            <span v-if="!canReceive(row) && !canReturn(row)" class="muted">已结案</span>
          </template>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="submitDialogVisible" title="确认送检（保存后锁定，不可撤销）" width="560px">
      <el-alert
        type="warning"
        :closable="false"
        show-icon
        class="dialog-alert"
        title="确认后实验室、送检日期与检测用途即定案，后续只能追加收样或退样记录"
      />
      <el-form label-width="110px">
        <el-form-item label="样品号">
          <span class="mono">{{ submitTarget?.code }}</span>
        </el-form-item>
        <el-form-item label="实验室" required>
          <el-input v-model="submitForm.lab" placeholder="如 省文物考古研究院科技考古实验室" />
        </el-form-item>
        <el-form-item label="送检日期" required>
          <el-date-picker v-model="submitForm.submitDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
        <el-form-item label="检测用途" required>
          <el-select v-model="submitForm.purpose" placeholder="选择检测用途" style="width: 100%">
            <el-option v-for="item in TEST_PURPOSES" :key="item" :label="item" :value="item" />
          </el-select>
        </el-form-item>
        <el-form-item label="约定收样日期" required>
          <el-date-picker v-model="submitForm.dueDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="submitDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmSubmit">确认送检</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="logDialogVisible" :title="`追加${logForm.type}记录`" width="520px">
      <el-form label-width="90px">
        <el-form-item label="样品号">
          <span class="mono">{{ logTarget?.code }}</span>
        </el-form-item>
        <el-form-item label="记录类型" required>
          <el-radio-group v-model="logForm.type">
            <el-radio-button
              v-for="item in SAMPLE_LOG_TYPES"
              :key="item"
              :value="item"
              :disabled="logTarget !== null && (item === '收样' ? !canReceive(logTarget) : !canReturn(logTarget))"
            >
              {{ item }}
            </el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="日期" required>
          <el-date-picker v-model="logForm.date" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
        <el-form-item label="经办人" required>
          <el-input v-model="logForm.operator" placeholder="如 祁野" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="logForm.note" placeholder="如 实验室签收单号、退回原因" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="logDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmLog">追加记录</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.form-card {
  border-radius: 12px;
  margin-bottom: 16px;
}
.alert {
  margin-bottom: 14px;
}
.overdue-line {
  margin: 2px 0;
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
.form {
  margin-top: 8px;
}
.actions {
  padding-left: 100px;
}
.mini {
  margin-left: 4px;
}
.expand {
  padding: 8px 16px;
}
.timeline {
  margin-top: 10px;
  padding-left: 4px;
}
.dialog-alert {
  margin-bottom: 14px;
}
</style>
