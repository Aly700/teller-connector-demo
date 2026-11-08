package dev.affan.teller.domain;

import java.util.Set;
import java.util.UUID;

public record CreateRuleCommand(
        String toolNameGlob,
        String argumentRegex,
        String agentId,
        RiskTier riskTier,
        Effect effect,
        int precedence,
        Long amountMinMinor,
        Long amountMaxMinor,
        String currency,
        Integer velocityMax,
        Long velocityWindowSeconds,
        Set<UUID> counterpartyAllow,
        Set<UUID> counterpartyDeny,
        Long fourEyesAboveMinor) {

    public CreateRuleCommand(
            String toolNameGlob,
            String argumentRegex,
            String agentId,
            RiskTier riskTier,
            Effect effect,
            int precedence) {
        this(
                toolNameGlob,
                argumentRegex,
                agentId,
                riskTier,
                effect,
                precedence,
                null,
                null,
                null,
                null,
                null,
                Set.of(),
                Set.of(),
                null);
    }
}
