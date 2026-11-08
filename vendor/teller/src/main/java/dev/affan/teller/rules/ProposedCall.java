package dev.affan.teller.rules;

import dev.affan.teller.domain.RiskTier;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

public record ProposedCall(
        String agentId,
        String toolName,
        String argumentsJson,
        RiskTier riskTier,
        Long amountMinor,
        String currency,
        UUID sourceAccountId,
        UUID counterpartyAccountId,
        Map<Long, Long> velocityCounts) {

    public ProposedCall {
        requireText(agentId, "agentId");
        requireText(toolName, "toolName");
        Objects.requireNonNull(argumentsJson, "argumentsJson");
        Objects.requireNonNull(riskTier, "riskTier");
        if (amountMinor != null && amountMinor < 0) {
            throw new IllegalArgumentException("amountMinor must not be negative");
        }
        currency = currency == null ? null : currency.toUpperCase(Locale.ROOT);
        velocityCounts = velocityCounts == null ? Map.of() : Map.copyOf(velocityCounts);
    }

    public ProposedCall(String agentId, String toolName, String argumentsJson, RiskTier riskTier) {
        this(agentId, toolName, argumentsJson, riskTier, null, null, null, null, Map.of());
    }

    private static void requireText(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
    }
}
