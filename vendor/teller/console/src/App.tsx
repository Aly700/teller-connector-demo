import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'
import type { FormEvent } from 'react'
import { TellerClient } from './api'
import { AuditView } from './AuditView'
import { QueueView } from './QueueView'
import { initialState, reducer } from './state'
import type { DecisionAction } from './types'
import './App.css'

function App() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const [now, setNow] = useState(new Date())
  const [from, setFrom] = useState(() => localDateTime(new Date(Date.now() - 24 * 60 * 60 * 1000)))
  const [to, setTo] = useState(() => localDateTime(new Date()))
  const client = useMemo(() => state.apiKey ? new TellerClient(state.apiKey) : null, [state.apiKey])

  const loadQueue = useCallback(async () => {
    if (!client) return
    dispatch({ type: 'loading' })
    try {
      dispatch({ type: 'queue-loaded', items: await client.loadQueue() })
    } catch (error) {
      dispatch({ type: 'failed', message: message(error) })
    }
  }, [client])

  const loadAudit = useCallback(async () => {
    if (!client) return
    dispatch({ type: 'loading' })
    try {
      dispatch({
        type: 'audit-loaded',
        records: await client.loadAudit(new Date(from).toISOString(), new Date(to).toISOString()),
      })
    } catch (error) {
      dispatch({ type: 'failed', message: message(error) })
    }
  }, [client, from, to])

  useEffect(() => {
    if (client) void loadQueue()
  }, [client, loadQueue])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  if (!state.apiKey) {
    return <AccessScreen onEnter={(apiKey, reviewer) => dispatch({ type: 'authenticated', apiKey, reviewer })} />
  }

  const decide = async (id: string, action: DecisionAction, reason: string) => {
    if (!client) return
    dispatch({ type: 'decision-started', id })
    try {
      await client.decideApproval(id, action, state.reviewer, reason)
      dispatch({ type: 'approval-decided', id })
    } catch (error) {
      dispatch({ type: 'failed', message: message(error) })
    }
  }

  const selectTab = (tab: 'queue' | 'audit') => {
    dispatch({ type: 'tab-selected', tab })
    if (tab === 'audit') void loadAudit()
  }

  return (
    <div className="app-shell">
      <header className="masthead">
        <a className="wordmark" href="/console/" aria-label="Teller approvals home">
          <span className="wordmark-mark">T</span>
          <span>Teller</span>
        </a>
        <div className="environment"><span />Live ledger · reviewer {state.reviewer}</div>
        <button className="text-button" type="button" onClick={() => dispatch({ type: 'signed-out' })}>
          Forget key
        </button>
      </header>

      <main>
        <div className="page-intro">
          <div>
            <p className="eyebrow">Four-eyes control</p>
            <h1>{state.activeTab === 'queue' ? 'Approval queue' : 'Audit register'}</h1>
          </div>
          <p className="intro-copy">
            {state.activeTab === 'queue'
              ? 'Held money stays reserved until a reviewer records the second decision.'
              : 'Newest-first, append-only evidence from the selected UTC window.'}
          </p>
        </div>

        <div className="view-bar">
          <nav className="tabs" aria-label="Console views">
            <button className={state.activeTab === 'queue' ? 'active' : ''} onClick={() => selectTab('queue')}>
              Queue <span>{state.queue.length}</span>
            </button>
            <button className={state.activeTab === 'audit' ? 'active' : ''} onClick={() => selectTab('audit')}>
              Audit
            </button>
          </nav>
          {state.activeTab === 'queue' && (
            <button className="button button-neutral" type="button" onClick={() => void loadQueue()} disabled={state.loading}>
              {state.loading ? 'Refreshing…' : 'Refresh queue'}
            </button>
          )}
        </div>

        {state.error && <div className="error-banner" role="alert">{state.error}</div>}

        {state.activeTab === 'queue' ? (
          <QueueView
            items={state.queue}
            reviewer={state.reviewer}
            now={now}
            decidingId={state.decidingId}
            onDecide={decide}
          />
        ) : (
          <AuditView
            records={state.audit}
            from={from}
            to={to}
            loading={state.loading}
            onFromChange={setFrom}
            onToChange={setTo}
            onRefresh={() => void loadAudit()}
          />
        )}
      </main>

      <footer>Amounts are minor ledger units rendered in their ISO currency · API key exists only in this tab's memory</footer>
    </div>
  )
}

function AccessScreen({ onEnter }: { onEnter: (apiKey: string, reviewer: string) => void }) {
  const [apiKey, setApiKey] = useState('')
  const [reviewer, setReviewer] = useState('')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (apiKey.trim() && reviewer.trim()) onEnter(apiKey, reviewer)
  }

  return (
    <main className="access-screen">
      <section className="access-panel">
        <div className="access-brand"><span className="wordmark-mark">T</span> Teller</div>
        <p className="eyebrow">Operator console</p>
        <h1>Review the money.<br />Record the reason.</h1>
        <p className="access-copy">Enter a scoped API key to open the live approval queue. It is held in memory and forgotten when this page closes or you sign out.</p>
        <form onSubmit={submit}>
          <label>Reviewer identity<input value={reviewer} onChange={(event) => setReviewer(event.target.value)} required autoComplete="username" placeholder="reviewer-7" /></label>
          <label>API key<input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} required autoComplete="off" placeholder="••••••••••••" /></label>
          <button className="button button-approve access-submit" type="submit">Open approval desk <span>→</span></button>
        </form>
      </section>
      <aside className="access-ledger" aria-hidden="true">
        <div><span>CONTROL</span><strong>04</strong><small>Four-eyes review</small></div>
        <div><span>STATE</span><strong>HOLD</strong><small>Funds remain reserved</small></div>
        <div><span>RECORD</span><strong>∞</strong><small>Append-only audit</small></div>
      </aside>
    </main>
  )
}

function localDateTime(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'The request could not be completed'
}

export default App
