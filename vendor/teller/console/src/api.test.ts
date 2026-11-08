import { afterEach, describe, expect, it, vi } from 'vitest'
import { TellerClient } from './api'

const approval = {
  id: 'approval-1',
  decisionId: 'decision-1',
  status: 'PENDING',
  decidedBy: null,
  decidedAt: null,
  reason: null,
  expiresAt: '2026-08-29T16:00:00Z',
  createdAt: '2026-08-29T15:00:00Z',
}

const transfer = {
  transferId: 'transfer-1',
  amountMinor: '6250',
  currency: 'USD',
  fromAccountId: 'source',
  toAccountId: 'destination',
  state: 'HELD',
  decisionId: 'decision-1',
  matchedRuleId: 'rule-1',
  createdAt: '2026-08-29T15:00:00Z',
}

describe('TellerClient', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('loads pending approvals and joins each one to its transfer', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse([approval]))
      .mockResolvedValueOnce(jsonResponse(transfer))
    vi.stubGlobal('fetch', fetchMock)

    const queue = await new TellerClient('memory-only-key').loadQueue()

    expect(queue).toEqual([{ approval, transfer }])
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/approvals?status=PENDING', {
      headers: { 'X-API-Key': 'memory-only-key' },
    })
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/approvals/approval-1/transfer', {
      headers: { 'X-API-Key': 'memory-only-key' },
    })
  })

  it('omits retained generic gate approvals that have no linked transfer', async () => {
    const generic = { ...approval, id: 'generic-approval', decisionId: 'generic-decision' }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse([generic, approval]))
      .mockResolvedValueOnce(new Response('{"detail":"Not found"}', {
        status: 404,
        headers: { 'Content-Type': 'application/problem+json' },
      }))
      .mockResolvedValueOnce(jsonResponse(transfer))
    vi.stubGlobal('fetch', fetchMock)

    const queue = await new TellerClient('memory-only-key').loadQueue()

    expect(queue).toEqual([{ approval, transfer }])
  })

  it('sends the required console reason when deciding an approval', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ...approval, status: 'APPROVED' }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new TellerClient('memory-only-key')

    await client.decideApproval('approval-1', 'approve', 'reviewer-7', 'Ticket verified')

    expect(fetchMock).toHaveBeenCalledWith('/approvals/approval-1/approve', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': 'memory-only-key',
      },
      body: JSON.stringify({ decidedBy: 'reviewer-7', reason: 'Ticket verified' }),
    })
  })

  it('requests the selected audit time range', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]))
    vi.stubGlobal('fetch', fetchMock)
    const client = new TellerClient('memory-only-key')

    await client.loadAudit('2026-08-28T00:00:00Z', '2026-08-29T00:00:00Z')

    expect(fetchMock).toHaveBeenCalledWith(
      '/audit?from=2026-08-28T00%3A00%3A00Z&to=2026-08-29T00%3A00%3A00Z',
      { headers: { 'X-API-Key': 'memory-only-key' } },
    )
  })
})

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
