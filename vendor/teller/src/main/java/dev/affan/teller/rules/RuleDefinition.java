package dev.affan.teller.rules;

import dev.affan.teller.domain.Effect;
import dev.affan.teller.domain.RiskTier;
import java.util.Currency;
import java.util.Locale;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

public record RuleDefinition(
        UUID id,
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

    public RuleDefinition {
        Objects.requireNonNull(id, "id");
        if (toolNameGlob == null || toolNameGlob.isBlank()) {
            throw new IllegalArgumentException("toolNameGlob must not be blank");
        }
        Objects.requireNonNull(effect, "effect");
        if (precedence < 0) {
            throw new IllegalArgumentException("precedence must not be negative");
        }
        if (amountMinMinor != null && amountMinMinor < 0
                || amountMaxMinor != null && amountMaxMinor < 0
                || fourEyesAboveMinor != null && fourEyesAboveMinor < 0) {
            throw new IllegalArgumentException("money matcher amounts must not be negative");
        }
        if (amountMinMinor != null && amountMaxMinor != null && amountMinMinor > amountMaxMinor) {
            throw new IllegalArgumentException("amountMinMinor must not exceed amountMaxMinor");
        }
        if ((velocityMax == null) != (velocityWindowSeconds == null)) {
            throw new IllegalArgumentException("velocityMax and velocityWindowSeconds must be set together");
        }
        if (velocityMax != null && velocityMax <= 0
                || velocityWindowSeconds != null && velocityWindowSeconds <= 0) {
            throw new IllegalArgumentException("velocity matchers must be positive");
        }
        if (currency != null) {
            currency = currency.toUpperCase(Locale.ROOT);
            Currency.getInstance(currency);
        }
        counterpartyAllow = counterpartyAllow == null ? Set.of() : Set.copyOf(counterpartyAllow);
        counterpartyDeny = counterpartyDeny == null ? Set.of() : Set.copyOf(counterpartyDeny);
    }

    public RuleDefinition(
            UUID id,
            String toolNameGlob,
            String argumentRegex,
            String agentId,
            RiskTier riskTier,
            Effect effect,
            int precedence) {
        this(
                id,
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
