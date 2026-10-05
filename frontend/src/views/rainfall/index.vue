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

    <ul v-if="notices.length" class="notice-list">
      <li v-for="(notice, index) in notices" :key="index">{{ notice }}</li>
    </ul>

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
          <td
            v-for="column in columns"
            :key="column"
            :class="{ 'empty-cell': isEmptyCell(row, column) }"
          >
            {{ cellText(row, column) }}
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
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
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">{{ emptyMessage }}</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条雨量监测记录</span>
      <span v-if="errorMessage" class="error-text">
        {{ errorMessage }}
        <button class="link" type="button" @click="reload">重试</button>
      </span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('rainfall')
const columns = ["监测编号", "雨量站名", "时段雨量", "累计雨量", "降雨强度", "采集时间", "记录人", "监测状态"]
const actions = ["提交采集", "确认核对", "标记异常"]
const statuses = ["待采集", "已采集", "已核对", "数据异常"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const notices = ref<string[]>([])
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

function countByStatus(status: string): number {
  return rows.value.filter((row) => String(row.status) === status).length
}

// 统计卡与状态图例都从同一份列表结果算，两处显示的数才一致
const stats = computed(() => [
  { label: '待采集雨量站', value: countByStatus('待采集') },
  { label: '已核对雨量站', value: countByStatus('已核对') },
  { label: '数据异常站数', value: countByStatus('数据异常') },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const activeFilterText = computed(() =>
  Object.entries(filters.value)
    .filter(([, value]) => value.trim() !== '')
    .map(([field, value]) => `${field}「${value.trim()}」`)
    .join('、'),
)

// 搜不到不等于数据丢了：点明是按什么条件没查到
const emptyMessage = computed(() => {
  if (!activeFilterText.value) {
    return '暂无雨量监测数据，可先登记雨量监测记录'
  }
  return `未找到符合 ${activeFilterText.value} 的雨量监测记录，已有记录没有丢失，可调整或重置条件后再查`
})

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || String(value).trim() === ''
}

function isEmptyCell(row: EntryRow, column: string): boolean {
  return column === '时段雨量' && isBlank(row[column])
}

// 时段雨量空着要明说：这是空数据，不是加载失败
function cellText(row: EntryRow, column: string): string {
  const value = row[column]
  if (isBlank(value)) {
    return column === '时段雨量' ? '空数据（待补录）' : '—'
  }
  return String(value)
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

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    notices.value = payload.notices ?? []
  } catch (error) {
    // 读取出错时清掉旧数，避免列表数与统计数对不上；重试成功后两处从同一份结果刷新
    rows.value = []
    total.value = 0
    notices.value = []
    errorMessage.value = `${error instanceof Error ? error.message : '雨量监测列表读取失败'}，可点「重试」再来一次`
  }
}

onMounted(reload)
</script>
