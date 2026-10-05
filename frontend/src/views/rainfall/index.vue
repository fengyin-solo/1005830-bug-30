<template>
  <section class="page" data-module="rainfall">
    <header class="page-head">
      <div>
        <h2>雨量监测管理</h2>
        <p class="page-desc">维护雨量监测记录，围绕监测编号、雨量站名、时段雨量、累计雨量做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记雨量监测记录</button>
        <button class="btn" type="button" @click="exportRows">导出雨量监测清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <div v-if="readFailed" class="state-panel error-panel" role="alert">
      <strong>雨量监测数据读取失败</strong>
      <p>{{ errorMessage }}</p>
      <button class="btn primary" type="button" @click="reload">重新读取</button>
    </div>

    <template v-else>
      <section v-if="blockedRows.length || duplicateGroups.length" class="quality-notice" aria-label="雨量数据报送校验结果">
        <article v-for="item in blockedRows" :key="`blocked-${item.row.id}`" class="notice-card blocked">
          <strong>记录已退回（内部编号 {{ item.row.id }}）</strong>
          <p>{{ item.message }}</p>
        </article>
        <article v-for="item in duplicateGroups" :key="`duplicate-${item.monitorId}`" class="notice-card duplicate">
          <strong>重复报送已归并</strong>
          <p>{{ item.message }}</p>
        </article>
      </section>

      <form class="filter-bar" @submit.prevent="reload">
        <label v-for="field in filterFields" :key="field" class="filter-item">
          <span>{{ field }}</span>
          <input v-model="filters[field]" :placeholder="`按${field}检索`" />
        </label>
        <button class="btn" type="submit">查询</button>
        <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
      </form>

      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in columns" :key="column">{{ column }}</th>
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="String(row.id)">
            <td v-for="column in columns" :key="column">
              <span :class="cellClass(row, column)">{{ displayCell(row, column) }}</span>
              <small
                v-for="issue in issuesFor(row, column)"
                :key="issue.message"
                class="cell-note"
                :class="issue.level"
              >
                {{ issue.message }}
              </small>
            </td>
            <td>
              <span>{{ row.effectiveStatus }}</span>
              <span v-if="row.qualityStatus === '数据异常'" class="quality-badge error">雨量数据异常</span>
            </td>
            <td class="row-actions">
              <button class="link" type="button" @click="openDetail(row)">查看详情</button>
              <button
                v-for="action in actions"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
            </td>
          </tr>
          <tr v-if="loading">
            <td :colspan="columns.length + 2" class="empty-state">雨量监测数据读取中……</td>
          </tr>
          <tr v-else-if="!rows.length">
            <td :colspan="columns.length + 2" class="empty-state">
              <template v-if="activeFilters.length">
                没有找到符合 {{ activeFilters.map(([field, value]) => `「${field}：${value}」`).join('、') }} 的雨量记录；
                当前有效、去重后记录共 {{ acceptedTotal }} 条，这不是数据丢失或读取失败。
                <button class="link" type="button" @click="resetFilters">清空条件后查看全部</button>
              </template>
              <template v-else>暂无有效雨量监测数据，请先补齐必填字段后登记报送。</template>
            </td>
          </tr>
        </tbody>
      </table>

      <footer class="page-foot">
        <span>
          当前显示 {{ rows.length }} 条；有效去重后共 {{ acceptedTotal }} 条；退回 {{ blockedRows.length }} 条；
          归并重复报送 {{ duplicateGroups.length }} 组
        </span>
        <p v-if="errorMessage" class="error-text">操作失败：{{ errorMessage }}</p>
      </footer>
    </template>

    <div v-if="selectedRow" class="modal-backdrop" @click.self="closeDetail">
      <section class="detail-modal" role="dialog" aria-modal="true" aria-label="雨量监测详情">
        <header class="detail-head">
          <h3>雨量监测详情</h3>
          <button class="btn" type="button" @click="closeDetail">关闭</button>
        </header>
        <dl class="detail-list">
          <template v-for="column in columns" :key="column">
            <dt>{{ column }}</dt>
            <dd>
              <span :class="cellClass(selectedRow, column)">{{ displayCell(selectedRow, column) }}</span>
              <small
                v-for="issue in issuesFor(selectedRow, column)"
                :key="issue.message"
                class="cell-note"
                :class="issue.level"
              >
                {{ issue.message }}
              </small>
            </dd>
          </template>
          <dt>当前状态</dt>
          <dd>
            <span>{{ selectedRow.effectiveStatus }}</span>
            <span v-if="selectedRow.qualityStatus === '数据异常'" class="quality-badge error">雨量数据异常</span>
          </dd>
        </dl>
        <section class="detail-conclusion">
          <h4>质量核对结论</h4>
          <p v-if="!selectedRow.issues.length" class="quality-pass">字段完整，累计雨量与各时段合计一致。</p>
          <ul>
            <li
              v-for="issue in selectedRow.issues"
              :key="issue.message"
              :class="issue.level === 'error' ? 'error-text' : 'warning-text'"
            >
              {{ issue.message }}
            </li>
          </ul>
        </section>
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listRainfallEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { RainfallIssue, RainfallViewRow } from '@/data/types'

const meta = moduleMeta('rainfall')
const columns = ['监测编号', '雨量站名', '时段雨量', '累计雨量', '降雨强度', '采集时间', '记录人', '监测状态']
const actions = ['提交采集', '确认核对', '标记异常']
const statuses = ['待采集', '已采集', '已核对', '数据异常']

const rows = ref<RainfallViewRow[]>([])
const validRows = ref<RainfallViewRow[]>([])
const total = ref(0)
const acceptedTotal = ref(0)
const blockedRows = ref<ReturnType<typeof listRainfallEntries>['blocked']>([])
const duplicateGroups = ref<ReturnType<typeof listRainfallEntries>['duplicates']>([])
const errorMessage = ref('')
const readFailed = ref(false)
const loading = ref(true)
const selectedId = ref<number | null>(null)
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const activeFilters = computed(() =>
  Object.entries(filters.value).filter(([, value]) => value.trim() !== ''),
)
const selectedRow = computed(() =>
  selectedId.value === null
    ? undefined
    : rows.value.find((row) => Number(row.id) === selectedId.value),
)
const statusSummary = computed(() => {
  const summary = statuses.map((status: string) => ({
    status,
    count: validRows.value.filter((row) => row.effectiveStatus === status).length,
  }))
  summary.push({
    status: '自动核对异常',
    count: validRows.value.filter(
      (row) => row.effectiveAbnormal && row.originalStatus !== '数据异常',
    ).length,
  })
  return summary
})
const stats = computed(() => [
  { label: '待采集雨量站', value: validRows.value.filter((row) => row.effectiveStatus === '待采集').length },
  { label: '已核对雨量站', value: validRows.value.filter((row) => row.effectiveStatus === '已核对').length },
  { label: '数据异常站数', value: validRows.value.filter((row) => row.effectiveAbnormal).length },
])

function issuesFor(row: RainfallViewRow, field: string): RainfallIssue[] {
  return row.issues.filter((issue) => issue.field === field)
}

function cellClass(row: RainfallViewRow, field: string): string {
  const issues = issuesFor(row, field)
  if (issues.some((issue) => issue.level === 'error')) {
    return 'error-text'
  }
  if (issues.some((issue) => issue.level === 'warning')) {
    return 'warning-text'
  }
  return ''
}

function displayCell(row: RainfallViewRow, field: string): string {
  const value = row[field]
  if (field === '时段雨量') {
    if (row.periodState === 'empty') return '空数据（待补采）'
    if (row.periodState === 'invalid') return '数值无效'
  }
  if (field === '累计雨量') {
    if (row.cumulativeState === 'empty') return '缺失'
    if (row.cumulativeState === 'invalid') return '数值无效'
  }
  return value === undefined || value === null || String(value).trim() === '' ? '—' : String(value)
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '雨量监测记录登记入口尚未接入审批流'
}

function openDetail(row: RainfallViewRow) {
  selectedId.value = Number(row.id)
}

function closeDetail() {
  selectedId.value = null
}

function runAction(action: string, row: RainfallViewRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  loading.value = true
  readFailed.value = false
  errorMessage.value = ''
  try {
    const payload = listRainfallEntries(filters.value)
    validRows.value = payload.items
    rows.value = payload.filteredItems
    total.value = payload.total
    acceptedTotal.value = payload.acceptedTotal
    blockedRows.value = payload.blocked
    duplicateGroups.value = payload.duplicates
  } catch (error) {
    validRows.value = []
    rows.value = []
    total.value = 0
    acceptedTotal.value = 0
    blockedRows.value = []
    duplicateGroups.value = []
    readFailed.value = true
    errorMessage.value = error instanceof Error ? error.message : '雨量监测列表读取失败'
  } finally {
    loading.value = false
  }
}

onMounted(reload)
</script>
