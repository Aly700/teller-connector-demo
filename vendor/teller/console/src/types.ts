export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'DENIED' | 'EXPIRED'
export type TransferState = 'PENDING' | 'AUTHORIZED' | 'HELD' | 'DENIED' | 'POSTED' | 'REVERSED'
export type ConsoleTab = 'queue' | 'audit'
export type DecisionAction = 'approve' | 'deny'

export interface Approval {
  id: string
  decisionId: string
  status: ApprovalStatus
  decidedBy: string | null
  reason: string | null
  decidedAt: string | null
  expiresAt: string
  createdAt: string
}

export interface ApprovalTransfer {
  transferId: string
  amountMinor: string
  currency: string
  fromAccountId: string
  toAccountId: string
  state: TransferState
  decisionId: string
  matchedRuleId: string | null
  createdAt: string
}

export interface QueueItem {
  approval: Approval
  transfer: ApprovalTransfer
}

export interface AuditRecord {
  id: string
  eventType: string
  aggregateType: string
  aggregateId: string
  occurredAt: string
  details: Record<string, unknown>
}
