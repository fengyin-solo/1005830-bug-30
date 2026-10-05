import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import { guardRainfallRows } from '@/data/rainfall-guard'
import type { RainfallAnomaly } from '@/data/rainfall-guard'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

const RAINFALL_KEY = 'rainfall'
const WATERLEVEL_KEY = 'waterlevel'
// 雨量异常同步到水位监测待复核清单时，用这一格认出行是雨量那边过来的
const RAINFALL_REVIEW_FLAG = '雨量异常待复核'

// 雨量异常的结论落到水位监测的待复核清单：只追加新行，既有核对记录按原层级保留。
function syncRainfallAnomalies(anomalies: RainfallAnomaly[]): void {
  if (anomalies.length === 0) {
    return
  }
  const waterRows = listRows(WATERLEVEL_KEY)
  const reviewed = new Set(
    waterRows
      .filter((row) => String(row['超标判定'] ?? '') === RAINFALL_REVIEW_FLAG)
      .map((row) => String(row['监测编号'] ?? '').trim()),
  )
  let nextId = waterRows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0)
  const additions: EntryRow[] = []
  for (const { row, reason } of anomalies) {
    const code = String(row['监测编号'] ?? '').trim()
    if (!code || reviewed.has(code)) {
      continue
    }
    reviewed.add(code)
    nextId += 1
    additions.push({
      id: nextId,
      status: '待采集',
      pending: true,
      abnormal: false,
      监测编号: code,
      监测点位: String(row['雨量站名'] ?? ''),
      水位读数: '待复核',
      警戒水位: '—',
      采集时间: String(row['采集时间'] ?? ''),
      监测人: String(row['记录人'] ?? ''),
      超标判定: RAINFALL_REVIEW_FLAG,
      监测状态: reason,
    })
  }
  if (additions.length > 0) {
    saveRows(WATERLEVEL_KEY, [...waterRows, ...additions])
  }
}

// 雨量列表过兜底：去重、拦截缺格、对账标异常，并把异常结论同步给水位监测
function applyRainfallGuard(): { rows: EntryRow[]; notices: string[] } {
  const guard = guardRainfallRows(listRows(RAINFALL_KEY))
  if (guard.changed) {
    saveRows(RAINFALL_KEY, [...guard.rows, ...guard.blocked])
  }
  syncRainfallAnomalies(guard.anomalies)
  return guard
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  let rows = listRows(key)
  let notices: string[] = []
  if (key === RAINFALL_KEY) {
    const guard = applyRainfallGuard()
    rows = guard.rows
    notices = guard.notices
  }
  const matched = filterRows(rows, filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length, notices }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  // 雨量的「标记异常」与自动对账用同一套规则：状态数据异常、不再待办、计入异常量
  const isRainfallAbnormal = key === RAINFALL_KEY && target === lastStatus
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)) || isRainfallAbnormal,
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  if (isRainfallAbnormal) {
    syncRainfallAnomalies([{ row: updated, reason: `人工执行「${action}」标为数据异常` }])
  }
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  // 雨量清单导出前也过一遍兜底：拦截的缺格记录与重复报送不进导出文件
  const source = key === RAINFALL_KEY ? guardRainfallRows(listRows(key)).rows : listRows(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of source) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    // 雨量模块先过兜底再统计，看板上的待办与异常量才和列表页一致
    const entries = meta.key === RAINFALL_KEY ? applyRainfallGuard().rows : (rows[meta.key] ?? [])
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
