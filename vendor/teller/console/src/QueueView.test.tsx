import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { QueueView } from './QueueView'
import type { QueueItem } from './types'

const item: QueueItem = {
  approval: {
    id: 'approval-1',
    decisionId: 'decision-1',
    status: 'PENDING',
    decidedBy: null,
    decidedAt: null,
    reason: null,
    expiresAt: '2026-08-29T16:00:00Z',
    createdAt: '2026-08-29T15:00:00Z',
  },
  transfer: {
    transferId: 'transfer-1',
    amountMinor: '6250',
    currency: 'USD',
    fromAccountId: '11111111-1111-1111-1111-111111111111',
    toAccountId: '22222222-2222-2222-2222-222222222222',
    state: 'HELD',
    decisionId: 'decision-1',
    matchedRuleId: '33333333-3333-3333-3333-333333333333',
    createdAt: '2026-08-29T15:00:00Z',
  },
}

describe('QueueView', () => {
  it('renders held transfer context and requires a reason before approval', async () => {
    const user = userEvent.setup()
    const decide = vi.fn().mockResolvedValue(undefined)
    render(
      <QueueView
        items={[item]}
        reviewer="reviewer-7"
        now={new Date('2026-08-29T15:12:00Z')}
        decidingId={null}
        onDecide={decide}
      />,
    )

    expect(screen.getByText('$62.50')).toBeInTheDocument()
    expect(screen.getByTitle('11111111-1111-1111-1111-111111111111')).toHaveTextContent('11111111')
    expect(screen.getByTitle('22222222-2222-2222-2222-222222222222')).toHaveTextContent('22222222')
    expect(screen.getByText('→')).toBeInTheDocument()
    expect(screen.getByText(/rule 33333333/)).toBeInTheDocument()
    expect(screen.getByText('12m old')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve transfer' })).toBeDisabled()

    await user.type(screen.getByLabelText('Decision reason'), 'Ticket verified')
    await user.click(screen.getByRole('button', { name: 'Approve transfer' }))

    expect(decide).toHaveBeenCalledWith('approval-1', 'approve', 'Ticket verified')
  })

  it('renders minor units above JavaScript safe integer range without rounding', () => {
    render(
      <QueueView
        items={[{
          ...item,
          transfer: { ...item.transfer, amountMinor: '9007199254740993' },
        }]}
        reviewer="reviewer-7"
        now={new Date('2026-08-29T15:12:00Z')}
        decidingId={null}
        onDecide={vi.fn()}
      />,
    )

    expect(screen.getByText('$90,071,992,547,409.93')).toBeInTheDocument()
  })

  it('locks every decision control while another approval is being recorded', () => {
    render(
      <QueueView
        items={[item]}
        reviewer="reviewer-7"
        now={new Date('2026-08-29T15:12:00Z')}
        decidingId="approval-elsewhere"
        onDecide={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('Decision reason')).toBeDisabled()
  })
})
