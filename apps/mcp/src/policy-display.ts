const titles: Record<string, string> = {
  'disabled-or-expired': 'Connection must be active',
  'disallowed-input': 'Request must be valid',
  'browser-approval': 'Transfers need approval',
  'sample-read': 'Account and transfer reads are allowed',
  'default-deny': 'Other requests are refused',
};

export const ruleTitle = (rule: string) => titles[rule] ?? 'Unrecognized rule';
export const policyVersionLabel = (version: string) =>
  version === 'sample-gate-v1' ? 'version 1' : 'Unrecognized version';
