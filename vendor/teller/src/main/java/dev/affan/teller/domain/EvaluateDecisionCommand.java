package dev.affan.teller.domain;

import java.util.UUID;

public record EvaluateDecisionCommand(
        UUID policyId,
        String agentId,
        String toolName,
        String argumentsJson,
        RiskTier riskTier) {
}
