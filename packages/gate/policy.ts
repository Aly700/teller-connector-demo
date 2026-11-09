import { READ_TOOLS } from "../state.ts";
export const POLICY_VERSION = "sample-gate-v1";
export const WRITE_TOOL = "request_transfer";
export const WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
};
export const POLICY_RULES = [
  {
    precedence: 10,
    rule: "disabled-or-expired",
    effect: "DENY",
    description:
      "The tool is disabled or the session belongs to an earlier reset.",
  },
  {
    precedence: 20,
    rule: "disallowed-input",
    effect: "DENY",
    description: "The input does not match the allowed arguments.",
  },
  {
    precedence: 30,
    rule: "browser-approval",
    effect: "REQUIRE_APPROVAL",
    description:
      "Every transfer request waits for your approval in this session.",
  },
  {
    precedence: 40,
    rule: "sample-read",
    effect: "ALLOW",
    description: "An allowed account or transfer read can reach Teller.",
  },
  {
    precedence: 50,
    rule: "default-deny",
    effect: "DENY",
    description: "Anything that does not match a rule above is refused.",
  },
] as const;
// Gate semantics: ascending precedence, first match, default deny. No model text enters this policy.
export function evaluate(
  tool: string,
  enabled: boolean,
  allowed: boolean,
  currentEpoch: boolean,
) {
  const matches = [
    !enabled || !currentEpoch,
    !allowed,
    tool === WRITE_TOOL,
    READ_TOOLS.includes(tool),
    true,
  ];
  const match = POLICY_RULES.find((_, index) => matches[index])!;
  return { version: POLICY_VERSION, rule: match.rule, effect: match.effect };
}
