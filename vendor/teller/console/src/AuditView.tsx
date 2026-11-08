import type { AuditRecord } from './types'

interface AuditViewProps {
  records: AuditRecord[]
  from: string
  to: string
  loading: boolean
  onFromChange: (value: string) => void
  onToChange: (value: string) => void
  onRefresh: () => void
}

export function AuditView({
  records,
  from,
  to,
  loading,
  onFromChange,
  onToChange,
  onRefresh,
}: AuditViewProps) {
  return (
    <section>
      <div className="audit-toolbar">
        <label>
          From
          <input type="datetime-local" value={from} onChange={(event) => onFromChange(event.target.value)} />
        </label>
        <label>
          To
          <input type="datetime-local" value={to} onChange={(event) => onToChange(event.target.value)} />
        </label>
        <button className="button button-neutral" type="button" onClick={onRefresh} disabled={loading}>
          {loading ? 'Reading…' : 'Refresh range'}
        </button>
      </div>

      {records.length === 0 && !loading ? (
        <div className="empty-state compact"><h2>No records in range</h2></div>
      ) : (
        <div className="audit-table-wrap">
          <table className="audit-table">
            <thead><tr><th>Time</th><th>Event</th><th>Aggregate</th><th>Details</th></tr></thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id}>
                  <td><time dateTime={record.occurredAt}>{formatTimestamp(record.occurredAt)}</time></td>
                  <td><span className="event-type">{record.eventType.replaceAll('_', ' ')}</span></td>
                  <td><strong>{record.aggregateType}</strong><small>{record.aggregateId.slice(0, 8)}</small></td>
                  <td><code>{JSON.stringify(record.details)}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false, timeZone: 'UTC',
  }).format(new Date(value)) + ' UTC'
}
