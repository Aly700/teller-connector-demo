import { useState } from 'react'
import type { DecisionAction, QueueItem } from './types'

interface QueueViewProps {
  items: QueueItem[]
  reviewer: string
  now: Date
  decidingId: string | null
  onDecide: (id: string, action: DecisionAction, reason: string) => Promise<void>
}

export function QueueView({ items, reviewer, now, decidingId, onDecide }: QueueViewProps) {
  if (items.length === 0) {
    return (
      <div className="empty-state">
        <span className="empty-mark" aria-hidden="true">✓</span>
        <h2>Queue clear</h2>
        <p>No transfers are waiting for a second set of eyes.</p>
      </div>
    )
  }

  return (
    <div className="approval-list" aria-live="polite">
      {items.map((item, index) => (
        <article className="approval-card" key={item.approval.id}>
          <header className="card-header">
            <div>
              <span className="queue-number">Review {String(index + 1).padStart(2, '0')}</span>
              <h2>{formatMinor(item.transfer.amountMinor, item.transfer.currency)}</h2>
            </div>
            <div className="hold-badge"><span />Held</div>
          </header>

          <dl className="transfer-route">
            <div>
              <dt>From</dt>
              <dd title={item.transfer.fromAccountId}>{shortId(item.transfer.fromAccountId)}</dd>
            </div>
            <div className="route-arrow" aria-hidden="true">→</div>
            <div>
              <dt>To</dt>
              <dd title={item.transfer.toAccountId}>{shortId(item.transfer.toAccountId)}</dd>
            </div>
          </dl>

          <div className="card-metadata">
            <span>{age(item.approval.createdAt, now)}</span>
            <span title={item.transfer.matchedRuleId ?? 'Default policy'}>
              {item.transfer.matchedRuleId ? `rule ${shortId(item.transfer.matchedRuleId)}` : 'default policy'}
            </span>
            <span title={item.transfer.transferId}>transfer {shortId(item.transfer.transferId)}</span>
          </div>

          <DecisionControls
            approvalId={item.approval.id}
            reviewer={reviewer}
            busy={decidingId === item.approval.id}
            locked={decidingId !== null}
            onDecide={onDecide}
          />
        </article>
      ))}
    </div>
  )
}

function DecisionControls({
  approvalId,
  reviewer,
  busy,
  locked,
  onDecide,
}: {
  approvalId: string
  reviewer: string
  busy: boolean
  locked: boolean
  onDecide: QueueViewProps['onDecide']
}) {
  const [reason, setReason] = useState('')
  const valid = reason.trim().length > 0

  return (
    <div className="decision-controls">
      <label htmlFor={`reason-${approvalId}`}>Decision reason</label>
      <textarea
        id={`reason-${approvalId}`}
        value={reason}
        maxLength={500}
        required
        disabled={locked}
        placeholder="Reference the ticket, check, or evidence"
        onChange={(event) => setReason(event.target.value)}
      />
      <div className="decision-footer">
        <span>Signing as <strong>{reviewer}</strong></span>
        <div className="decision-buttons">
          <button
            type="button"
            className="button button-deny"
            disabled={!valid || locked}
            onClick={() => onDecide(approvalId, 'deny', reason.trim())}
          >
            Deny transfer
          </button>
          <button
            type="button"
            className="button button-approve"
            disabled={!valid || locked}
            onClick={() => onDecide(approvalId, 'approve', reason.trim())}
          >
            {busy ? 'Recording…' : 'Approve transfer'}
          </button>
        </div>
      </div>
    </div>
  )
}

function formatMinor(amountMinor: string, currency: string): string {
  const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency })
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2
  const minor = BigInt(amountMinor)
  const negative = minor < 0n
  const absolute = negative ? -minor : minor
  const scale = 10n ** BigInt(digits)
  const whole = absolute / scale
  const fraction = digits === 0
    ? ''
    : (absolute % scale).toString().padStart(digits, '0')
  const groupedWhole = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
  }).format(whole)

  const formatted = formatter.formatToParts(0).map((part) => {
    if (part.type === 'integer') return groupedWhole
    if (part.type === 'fraction') return fraction
    if (part.type === 'group' || part.type === 'minusSign') return ''
    return part.value
  }).join('')

  return negative ? `-${formatted}` : formatted
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id
}

function age(createdAt: string, now: Date): string {
  const seconds = Math.max(0, Math.floor((now.getTime() - new Date(createdAt).getTime()) / 1000))
  if (seconds < 60) return `${seconds}s old`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m old`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h old`
  return `${Math.floor(seconds / 86400)}d old`
}
