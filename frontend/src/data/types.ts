/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type RainfallIssueLevel = 'warning' | 'error'
export type RainfallIssue = {
  level: RainfallIssueLevel
  field: string
  message: string
  difference?: number
  direction?: '多报' | '少报' | '缺失'
}

export type RainfallBlockedRow = {
  row: EntryRow
  monitorId: string
  missingFields: string[]
  message: string
}

export type RainfallDuplicateGroup = {
  monitorId: string
  keptRow: EntryRow
  removedRows: EntryRow[]
  message: string
}

export type RainfallNumberState = 'valid' | 'empty' | 'invalid'

export type RainfallViewRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]:
    | string
    | number
    | boolean
    | number[]
    | RainfallIssue[]
    | null
  originalStatus: string
  effectiveStatus: string
  qualityStatus: '正常' | '数据异常'
  effectiveAbnormal: boolean
  periodState: RainfallNumberState
  periodValues: number[]
  periodSum: number | null
  cumulativeState: RainfallNumberState
  reportedCumulative: number | null
  issues: RainfallIssue[]
}

export type RainfallDataset = {
  items: RainfallViewRow[]
  blocked: RainfallBlockedRow[]
  duplicates: RainfallDuplicateGroup[]
}

export type RainfallPageResult = {
  items: RainfallViewRow[]
  filteredItems: RainfallViewRow[]
  total: number
  page: number
  size: number
  acceptedTotal: number
  blocked: RainfallBlockedRow[]
  duplicates: RainfallDuplicateGroup[]
  activeFilterCount: number
}

export type WaterlevelReviewItem = {
  rainfallId: number
  monitorId: string
  station: string
  conclusion: string
  difference?: number
  originalStatus: string
  reviewStatus: '待复核'
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
