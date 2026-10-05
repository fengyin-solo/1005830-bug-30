import { MODULE_BY_KEY } from '@/data/modules'
import { buildRainfallDataset, rainfallReviewItems } from '@/data/rainfall-quality'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
  RainfallPageResult,
  WaterlevelReviewItem,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows<T extends Record<string, unknown>>(
  rows: T[],
  filters: Record<string, string>,
): T[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function listRainfallEntries(filters: Record<string, string> = {}): RainfallPageResult {
  const dataset = buildRainfallDataset(listRows('rainfall'))
  const matched = filterRows(dataset.items, filters)
  const activeFilterCount = Object.values(filters).filter((value) => value.trim() !== '').length
  return {
    items: dataset.items,
    filteredItems: matched,
    total: matched.length,
    page: 1,
    size: matched.length,
    acceptedTotal: dataset.items.length,
    blocked: dataset.blocked,
    duplicates: dataset.duplicates,
    activeFilterCount,
  }
}

export function listWaterlevelReviewItems(): WaterlevelReviewItem[] {
  return rainfallReviewItems(listRows('rainfall'))
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
  const marksAbnormal =
    NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)) || target.includes('异常')
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: marksAbnormal,
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

function csvCell(value: unknown): string {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.map(csvCell).join(',')]
  for (const row of listRows(key)) {
    lines.push(
      [row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status]
        .map(csvCell)
        .join(','),
    )
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function exportRainfallEntries(): { filename: string; content: string } {
  const meta = moduleMeta('rainfall')
  const dataset = buildRainfallDataset(listRows('rainfall'))
  const header = ['编号', ...meta.fields, '当前状态', '核对说明']
  const lines = [header.map(csvCell).join(',')]
  for (const row of dataset.items) {
    lines.push(
      [
        row.id,
        ...meta.fields.map((field) => row[field] ?? ''),
        row.effectiveStatus,
        row.issues.map((issue) => issue.message).join('；'),
      ]
        .map(csvCell)
        .join(','),
    )
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } =
    key === 'rainfall' ? exportRainfallEntries() : exportEntries(key)
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
    const entries = rows[meta.key] ?? []
    if (meta.key === 'rainfall') {
      const dataset = buildRainfallDataset(entries)
      return {
        name: meta.name,
        created: dataset.items.length,
        pending: dataset.items.filter((row) => row.pending && !row.effectiveAbnormal).length,
        abnormal: dataset.items.filter((row) => row.effectiveAbnormal).length,
      }
    }
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
