import type { AuditRecord, ConsoleTab, QueueItem } from './types'

export interface ConsoleState {
  apiKey: string | null
  reviewer: string
  activeTab: ConsoleTab
  queue: QueueItem[]
  audit: AuditRecord[]
  loading: boolean
  decidingId: string | null
  error: string | null
}

export const initialState: ConsoleState = {
  apiKey: null,
  reviewer: '',
  activeTab: 'queue',
  queue: [],
  audit: [],
  loading: false,
  decidingId: null,
  error: null,
}

export type ConsoleAction =
  | { type: 'authenticated'; apiKey: string; reviewer?: string }
  | { type: 'signed-out' }
  | { type: 'tab-selected'; tab: ConsoleTab }
  | { type: 'loading' }
  | { type: 'queue-loaded'; items: QueueItem[] }
  | { type: 'audit-loaded'; records: AuditRecord[] }
  | { type: 'decision-started'; id: string }
  | { type: 'approval-decided'; id: string }
  | { type: 'failed'; message: string }

export function reducer(state: ConsoleState, action: ConsoleAction): ConsoleState {
  switch (action.type) {
    case 'authenticated':
      return {
        ...initialState,
        apiKey: action.apiKey,
        reviewer: action.reviewer?.trim() || 'console-reviewer',
        loading: true,
      }
    case 'signed-out':
      return { ...initialState }
    case 'tab-selected':
      return { ...state, activeTab: action.tab, error: null }
    case 'loading':
      return { ...state, loading: true, error: null }
    case 'queue-loaded':
      return { ...state, queue: action.items, loading: false, error: null }
    case 'audit-loaded':
      return { ...state, audit: action.records, loading: false, error: null }
    case 'decision-started':
      return { ...state, decidingId: action.id, error: null }
    case 'approval-decided':
      return {
        ...state,
        queue: state.queue.filter((item) => item.approval.id !== action.id),
        decidingId: null,
        error: null,
      }
    case 'failed':
      return { ...state, loading: false, decidingId: null, error: action.message }
  }
}
