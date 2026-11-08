import { READ_TOOLS } from '../state.ts';
export const POLICY_VERSION = 'sample-gate-v1';
export const WRITE_TOOL = 'request_sample_transfer';
export const WRITE_ANNOTATIONS = { readOnlyHint:false, destructiveHint:true, idempotentHint:true, openWorldHint:false };
// Gate semantics: ascending precedence, first match, default deny. No model text enters this policy.
export function evaluate(tool: string, enabled: boolean, allowed: boolean, currentEpoch: boolean) {
  const rules = [
    { precedence:10, rule:'disabled-or-expired', matches:!enabled || !currentEpoch, effect:'DENY' },
    { precedence:20, rule:'disallowed-input', matches:!allowed, effect:'DENY' },
    { precedence:30, rule:'browser-approval', matches:tool===WRITE_TOOL, effect:'REQUIRE_APPROVAL' },
    { precedence:40, rule:'sample-read', matches:READ_TOOLS.includes(tool), effect:'ALLOW' },
  ];
  const match=rules.sort((a,b)=>a.precedence-b.precedence).find(r=>r.matches);
  return { version:POLICY_VERSION, rule:match?.rule ?? 'default-deny', effect:match?.effect ?? 'DENY' };
}
