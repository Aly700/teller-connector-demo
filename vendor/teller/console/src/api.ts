import type { Approval, AuditRecord, DecisionAction, QueueItem, ApprovalTransfer } from './types'

export class TellerClient {
  private readonly apiKey: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  async loadQueue(): Promise<QueueItem[]> {
    const approvals = await this.get<Approval[]>('/approvals?status=PENDING')
    const joined = await Promise.all(approvals.map(async (approval): Promise<QueueItem | null> => {
      try {
        return {
          approval,
          transfer: await this.get<ApprovalTransfer>(`/approvals/${approval.id}/transfer`),
        }
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null
        throw error
      }
    }))
    return joined.filter((item): item is QueueItem => item !== null)
  }

  async decideApproval(
    approvalId: string,
    action: DecisionAction,
    decidedBy: string,
    reason: string,
  ): Promise<Approval> {
    return this.request<Approval>(`/approvals/${approvalId}/${action}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
      },
      body: JSON.stringify({ decidedBy, reason }),
    })
  }

  async loadAudit(from: string, to: string): Promise<AuditRecord[]> {
    const query = new URLSearchParams({ from, to })
    return this.get<AuditRecord[]>(`/audit?${query.toString()}`)
  }

  private get<T>(path: string): Promise<T> {
    return this.request<T>(path, {
      headers: { 'X-API-Key': this.apiKey },
    })
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(path, init)
    if (!response.ok) {
      throw new ApiError(response.status, await errorMessage(response))
    }
    return response.json() as Promise<T>
  }
}

class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const problem = await response.json() as { detail?: string; title?: string }
    return problem.detail || problem.title || `Request failed (${response.status})`
  } catch {
    return `Request failed (${response.status})`
  }
}
