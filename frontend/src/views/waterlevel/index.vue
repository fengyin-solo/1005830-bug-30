<template>
  <section class="page" data-module="waterlevel">
    <header class="page-head">
      <div>
        <h2>水位监测管理</h2>
        <p class="page-desc">维护水位监测记录，围绕监测编号、监测点位、水位读数、警戒水位做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记水位监测记录</button>
        <button class="btn" type="button" @click="exportRows">导出水位监测清单</button>
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

    <section class="review-panel" aria-label="雨量异常待复核清单">
      <header class="review-head">
        <div>
          <h3>雨量异常待复核清单</h3>
          <p>雨量模块核对出的异常自动进入本清单；只新增待复核事项，不改动既有水位记录和原核对层级。</p>
        </div>
        <button class="btn" type="button" @click="loadReviewItems">刷新待复核</button>
      </header>
      <p v-if="reviewError" class="error-text">
        {{ reviewError }}
        <button class="link" type="button" @click="loadReviewItems">重新读取</button>
      </p>
      <table v-else class="data-table review-table">
        <thead>
          <tr>
            <th>雨量记录编号</th>
            <th>监测编号</th>
            <th>雨量站名</th>
            <th>原雨量核对层级</th>
            <th>异常结论</th>
            <th>差额</th>
            <th>复核状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in reviewItems" :key="item.rainfallId">
            <td>{{ item.rainfallId }}</td>
            <td>{{ item.monitorId }}</td>
            <td>{{ item.station }}</td>
            <td>{{ item.originalStatus }}</td>
            <td class="error-text">{{ item.conclusion }}</td>
            <td>{{ formatDifference(item.difference) }}</td>
            <td><span class="review-badge">{{ item.reviewStatus }}</span></td>
          </tr>
          <tr v-if="!reviewItems.length">
            <td colspan="7" class="empty-state">暂无雨量异常待复核事项</td>
          </tr>
        </tbody>
      </table>
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
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
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
          <td :colspan="columns.length + 2" class="empty-state">
            <template v-if="activeFilters.length">
              没有找到符合 {{ activeFilters.map(([field, value]) => `「${field}：${value}」`).join('、') }} 的水位记录，
              可清空条件后重新查看；这不是数据丢失或读取失败。
            </template>
            <template v-else>暂无水位监测数据，可先登记水位监测记录</template>
          </td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>
        共 {{ total }} 条水位监测记录；雨量异常待复核 {{ reviewItems.length }} 条
      </span>
      <span v-if="errorMessage" class="error-text">
        {{ errorMessage }}
        <button class="link" type="button" @click="reload">重新读取</button>
      </span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  listWaterlevelReviewItems,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow, WaterlevelReviewItem } from '@/data/types'

const meta = moduleMeta('waterlevel')
const columns = ['监测编号', '监测点位', '水位读数', '警戒水位', '采集时间', '监测人', '超标判定', '监测状态']
const actions = ['提交采集', '判定正常', '标记超警戒']
const statuses = ['待采集', '已采集', '水位正常', '超警戒']
const stats = [{ label: '待采集点位', value: 0 }, { label: '水位正常点位', value: 0 }, { label: '超警戒点位数', value: 0 }]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const reviewItems = ref<WaterlevelReviewItem[]>([])
const reviewError = ref('')

const activeFilters = computed(() =>
  Object.entries(filters.value).filter(([, value]) => value.trim() !== ''),
)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function formatDifference(difference: number | undefined): string {
  return difference === undefined ? '—' : `${difference} mm`
}

function loadReviewItems() {
  reviewError.value = ''
  try {
    reviewItems.value = listWaterlevelReviewItems()
  } catch (error) {
    reviewItems.value = []
    reviewError.value = error instanceof Error ? error.message : '雨量异常待复核清单读取失败'
  }
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '水位监测记录登记入口尚未接入审批流'
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
    loadReviewItems()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '水位监测列表读取失败'
  }
}

onMounted(reload)
</script>
