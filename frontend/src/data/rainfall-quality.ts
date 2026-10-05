import type {
  EntryRow,
  RainfallBlockedRow,
  RainfallDataset,
  RainfallDuplicateGroup,
  RainfallIssue,
  RainfallNumberState,
  RainfallViewRow,
  WaterlevelReviewItem,
} from './types'

const REQUIRED_FIELDS = ['监测编号', '雨量站名']
export const RAINFALL_ABNORMAL_STATUS = '数据异常'
const RAINFALL_CHECKED_STATUS = '已核对'
const TOLERANCE = 0.01

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || String(value).trim() === ''
}

function parseAmount(value: unknown): { state: RainfallNumberState; amount: number | null } {
  if (isBlank(value)) {
    return { state: 'empty', amount: null }
  }
  const normalized = String(value).trim().replace(/mm$/i, '').replace(/毫米$/, '')
  const amount = Number(normalized)
  if (!Number.isFinite(amount) || amount < 0) {
    return { state: 'invalid', amount: null }
  }
  return { state: 'valid', amount }
}

function parsePeriods(value: unknown): { state: RainfallNumberState; amounts: number[] } {
  if (isBlank(value)) {
    return { state: 'empty', amounts: [] }
  }
  const parts = String(value).split(/[，,、;；\s]+/).filter((part) => part.trim() !== '')
  if (parts.length === 0) {
    return { state: 'empty', amounts: [] }
  }
  const amounts = parts.map((part) => Number(part.trim()))
  if (amounts.some((amount) => !Number.isFinite(amount) || amount < 0)) {
    return { state: 'invalid', amounts: [] }
  }
  return { state: 'valid', amounts }
}

function roundAmount(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function makeIssue(
  level: RainfallIssue['level'],
  field: string,
  message: string,
  extra: Partial<RainfallIssue> = {},
): RainfallIssue {
  return { level, field, message, ...extra }
}

function collectBlocked(rows: EntryRow[]): {
  available: EntryRow[]
  blocked: RainfallBlockedRow[]
} {
  const available: EntryRow[] = []
  const blocked: RainfallBlockedRow[] = []

  for (const row of rows) {
    const missingFields = REQUIRED_FIELDS.filter((field) => isBlank(row[field]))
    if (missingFields.length > 0) {
      const monitorId = isBlank(row['监测编号']) ? '未填写监测编号' : String(row['监测编号']).trim()
      blocked.push({
        row,
        monitorId,
        missingFields,
        message: `${monitorId} 的记录已拦截：缺少${missingFields.map((field) => `「${field}」`).join('、')}，补齐后再报送。`,
      })
      continue
    }
    available.push(row)
  }

  return { available, blocked }
}

function dedupeRows(rows: EntryRow[]): {
  kept: EntryRow[]
  duplicates: RainfallDuplicateGroup[]
} {
  const groups = new Map<string, EntryRow[]>()
  for (const row of rows) {
    const monitorId = String(row['监测编号']).trim()
    const group = groups.get(monitorId)
    if (group) {
      group.push(row)
    } else {
      groups.set(monitorId, [row])
    }
  }

  const keptIds = new Set<number>()
  const duplicates: RainfallDuplicateGroup[] = []

  for (const [monitorId, group] of groups) {
    if (group.length === 1) {
      keptIds.add(Number(group[0].id))
      continue
    }
    const ordered = [...group].sort((a, b) => {
      const timeA = new Date(String(a['采集时间'] ?? '')).getTime()
      const timeB = new Date(String(b['采集时间'] ?? '')).getTime()
      if (Number.isNaN(timeA) || Number.isNaN(timeB) || timeA === timeB) {
        return Number(b.id) - Number(a.id)
      }
      return timeB - timeA
    })
    const keptRow = ordered[0]
    keptIds.add(Number(keptRow.id))
    const removedRows = ordered.slice(1)
    duplicates.push({
      monitorId,
      keptRow,
      removedRows,
      message: `监测编号「${monitorId}」重复报送 ${group.length} 次，已保留采集时间最新的一份（编号 ${keptRow.id}），其余 ${removedRows.length} 份不重复计入。`,
    })
  }

  return {
    kept: rows.filter((row) => keptIds.has(Number(row.id))),
    duplicates,
  }
}

function decorateRow(row: EntryRow): RainfallViewRow {
  const issues: RainfallIssue[] = []
  const periods = parsePeriods(row['时段雨量'])
  const cumulative = parseAmount(row['累计雨量'])
  const periodSum =
    periods.state === 'valid'
      ? roundAmount(periods.amounts.reduce((sum, amount) => sum + amount, 0))
      : null

  if (periods.state === 'empty') {
    issues.push(makeIssue('warning', '时段雨量', '时段雨量为空数据，暂未成功采集；不是页面加载失败。'))
  } else if (periods.state === 'invalid') {
    issues.push(makeIssue('error', '时段雨量', '时段雨量不是有效的非负数值，无法参与累计核对。'))
  }

  if (cumulative.state === 'empty') {
    issues.push(makeIssue('error', '累计雨量', '累计雨量缺失，无法完成雨量核对。', { direction: '缺失' }))
  } else if (cumulative.state === 'invalid') {
    issues.push(makeIssue('error', '累计雨量', '累计雨量不是有效的非负数值。'))
  }

  let difference: number | undefined
  let direction: RainfallIssue['direction']
  if (periods.state === 'valid' && cumulative.state === 'valid' && periodSum !== null) {
    const rawDifference = roundAmount(cumulative.amount as number - periodSum)
    if (Math.abs(rawDifference) > TOLERANCE) {
      difference = Math.abs(rawDifference)
      direction = rawDifference > 0 ? '多报' : '少报'
      issues.push(
        makeIssue(
          'error',
          '累计雨量',
          `累计雨量与各时段雨量合计不一致，${direction} ${difference} mm；累计雨量 ${cumulative.amount} mm，时段合计 ${periodSum} mm。`,
          { difference, direction },
        ),
      )
    }
  }

  const manuallyAbnormal = row.abnormal === true || String(row.status) === RAINFALL_ABNORMAL_STATUS
  if (manuallyAbnormal) {
    issues.push(makeIssue('error', '监测状态', '该记录已被人工标记为数据异常，需复核。'))
  }

  const hasError = issues.some((issue) => issue.level === 'error')
  const originalStatus = String(row.status ?? '')

  return {
    ...row,
    originalStatus,
    effectiveStatus: originalStatus || '待采集',
    qualityStatus: hasError ? '数据异常' : '正常',
    effectiveAbnormal: hasError,
    periodState: periods.state,
    periodValues: periods.amounts,
    periodSum,
    cumulativeState: cumulative.state,
    reportedCumulative: cumulative.amount,
    issues,
  }
}

export function buildRainfallDataset(rows: unknown): RainfallDataset {
  const sourceRows = Array.isArray(rows)
    ? rows.filter((row): row is EntryRow => Boolean(row) && typeof row === 'object')
    : []
  const { available, blocked } = collectBlocked(sourceRows)
  const { kept, duplicates } = dedupeRows(available)

  return {
    items: kept.map(decorateRow),
    blocked,
    duplicates,
  }
}

export function rainfallReviewItems(rows: unknown): WaterlevelReviewItem[] {
  const dataset = buildRainfallDataset(rows)
  return dataset.items
    .filter((row) => row.effectiveAbnormal)
    .map((row) => {
      const errorMessages = row.issues
        .filter((issue) => issue.level === 'error')
        .map((issue) => issue.message)
      const mismatch = row.issues.find(
        (issue) => issue.field === '累计雨量' && issue.difference !== undefined,
      )
      return {
        rainfallId: Number(row.id),
        monitorId: String(row['监测编号']),
        station: String(row['雨量站名']),
        conclusion: errorMessages.join('；'),
        difference: mismatch?.difference,
        originalStatus: row.originalStatus === RAINFALL_CHECKED_STATUS ? RAINFALL_CHECKED_STATUS : row.originalStatus,
        reviewStatus: '待复核' as const,
      }
    })
}
