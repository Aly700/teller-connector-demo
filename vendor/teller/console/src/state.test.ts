import { describe, expect, it } from 'vitest'
import { initialState, reducer } from './state'

describe('console reducer', () => {
  it('keeps the API key only in in-memory application state', () => {
    localStorage.setItem('unrelated', 'keep-me')

    const authenticated = reducer(initialState, {
      type: 'authenticated',
      apiKey: 'session-secret',
    })
    const signedOut = reducer(authenticated, { type: 'signed-out' })

    expect(authenticated.apiKey).toBe('session-secret')
    expect(signedOut.apiKey).toBeNull()
    expect(localStorage.getItem('apiKey')).toBeNull()
    expect(localStorage.getItem('unrelated')).toBe('keep-me')
  })

  it('replaces a decided approval without disturbing the rest of the queue', () => {
    const first = {
      approval: {
        id: 'approval-1',
        decisionId: 'decision-1',
        status: 'PENDING' as const,
        expiresAt: '2026-08-29T16:00:00Z',
        createdAt: '2026-08-29T15:00:00Z',
        decidedBy: null,
        decidedAt: null,
        reason: null,
      },
      transfer: {
        transferId: 'transfer-1',
        amountMinor: '6250',
        currency: 'USD',
        fromAccountId: 'source',
        toAccountId: 'destination',
        state: 'HELD' as const,
        decisionId: 'decision-1',
        matchedRuleId: 'rule-1',
        createdAt: '2026-08-29T15:00:00Z',
      },
    }
    const loaded = reducer(initialState, { type: 'queue-loaded', items: [first] })

    const decided = reducer(loaded, { type: 'approval-decided', id: 'approval-1' })

    expect(decided.queue).toEqual([])
  })
})
