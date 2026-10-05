import type { EntryRow } from './types'

// 雨量监测的兜底规则：缺字段整条拦截、空值明说、累计对账、重复报送去重。
// 规则只写在这一处，页面只展示这里给出的结论，不各自再判一遍。

// 进列表前必须填的格子，缺了整条拦下
const REQUIRED_FIELDS = ['监测编号', '雨量站名']
// 已核对是人工确认过的层级，自动对账不动它，按原层级保留
const VERIFIED_STATUS = '已核对'
const ABNORMAL_STATUS = '数据异常'
// 累计雨量与各时段合计允许的末位误差（毫米）
const TOLERANCE = 0.1

export type RainfallAnomaly = {
  row: EntryRow
  reason: string
}

export type RainfallGuardResult = {
  /** 可进列表的记录：已去重、缺格的已拦下、对不上的已标异常 */
  rows: EntryRow[]
  /** 缺必填格被拦截退回的记录：留在存储里不丢，但不进列表 */
  blocked: EntryRow[]
  /** 给页面原样展示的兜底说明 */
  notices: string[]
  /** 本次新判出的雨量异常（含差额原因），由服务层同步到水位监测待复核清单 */
  anomalies: RainfallAnomaly[]
  /** 存储层是否需要回写（去重或状态流转过） */
  changed: boolean
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || String(value).trim() === ''
}

function codeOf(row: EntryRow): string {
  return String(row['监测编号'] ?? '').trim()
}

// 时段雨量允许一次填多个时段（逗号、顿号、分号或空格分隔），求合计后与累计雨量对账
function parsePeriodValues(raw: unknown): number[] {
  if (isBlank(raw)) {
    return []
  }
  return String(raw)
    .split(/[,，、;；\s]+/)
    .map((part) => Number(part))
    .filter((num) => Number.isFinite(num))
}

function round1(num: number): number {
  return Math.round(num * 10) / 10
}

export function guardRainfallRows(rows: EntryRow[]): RainfallGuardResult {
  const notices: string[] = []
  const anomalies: RainfallAnomaly[] = []
  let changed = false

  // 同一监测编号重复报送只留一份，先收到的留下
  const seen = new Set<string>()
  const dropped = new Map<string, number>()
  const deduped: EntryRow[] = []
  for (const row of rows) {
    const code = codeOf(row)
    if (code) {
      if (seen.has(code)) {
        dropped.set(code, (dropped.get(code) ?? 0) + 1)
        changed = true
        continue
      }
      seen.add(code)
    }
    deduped.push(row)
  }
  for (const [code, count] of dropped) {
    notices.push(`监测编号 ${code} 重复报送 ${count + 1} 份，已只保留一份`)
  }

  // 缺必填格的整条拦截退回，退回时点名少的是哪一格
  const blocked: EntryRow[] = []
  const valid: EntryRow[] = []
  for (const row of deduped) {
    const missing = REQUIRED_FIELDS.filter((field) => isBlank(row[field]))
    if (missing.length > 0) {
      const label = isBlank(row['监测编号']) ? `记录#${row.id}` : `监测编号 ${codeOf(row)}`
      notices.push(`${label} 的记录缺少「${missing.join('」「')}」，整条已拦截退回，不进入列表`)
      blocked.push(row)
      continue
    }
    valid.push(row)
  }

  // 空值与对账：空数据明说不是加载失败；累计对不上按「标记异常」同一套规则处理
  const rowsOut: EntryRow[] = []
  for (const row of valid) {
    const code = codeOf(row)
    if (isBlank(row['时段雨量'])) {
      notices.push(`监测编号 ${code} 的时段雨量暂为空数据（是空数据，不是读取失败），待补录`)
    }
    // 已核对的既有记录按原层级保留；已标异常的不再重复判
    if (String(row.status) === VERIFIED_STATUS || String(row.status) === ABNORMAL_STATUS) {
      rowsOut.push(row)
      continue
    }
    const periods = parsePeriodValues(row['时段雨量'])
    const total = Number(row['累计雨量'])
    if (periods.length > 0 && !isBlank(row['累计雨量']) && Number.isFinite(total)) {
      const sum = round1(periods.reduce((acc, num) => acc + num, 0))
      const diff = round1(total - sum)
      if (Math.abs(diff) > TOLERANCE) {
        const reason = `累计雨量 ${round1(total)} 与各时段合计 ${sum} 对不上，相差 ${Math.abs(diff)}`
        notices.push(`监测编号 ${code}：${reason}，已按规则标为数据异常`)
        // 与「标记异常」动作同一套结果：状态数据异常、不再待办、计入异常量
        const flagged: EntryRow = { ...row, status: ABNORMAL_STATUS, pending: false, abnormal: true }
        anomalies.push({ row: flagged, reason })
        rowsOut.push(flagged)
        changed = true
        continue
      }
    }
    rowsOut.push(row)
  }

  return { rows: rowsOut, blocked, notices, anomalies, changed }
}
