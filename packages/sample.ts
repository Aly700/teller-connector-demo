export const SAMPLE = { sampleData: true as const, label: 'Demo data' as const, notice: 'Demo data. No real money.' };
export const ACCOUNTS = ['operating', 'reserve'] as const;
export const REFERENCES = ['sample-posted', 'sample-held', 'request-1', 'request-2', 'request-3', 'request-4', 'request-5'] as const;
export type AccountAlias = typeof ACCOUNTS[number];
export type PoolEntry = { poolId: string; accounts: Record<AccountAlias, string>; transfers: Record<'sample-posted' | 'sample-held', string> };
export type Pool = { epoch: string; expiresAt: number; pools: PoolEntry[] };
