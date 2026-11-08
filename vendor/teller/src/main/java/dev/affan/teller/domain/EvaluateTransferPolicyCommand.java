package dev.affan.teller.domain;

import java.util.Map;
import java.util.Objects;
import java.util.UUID;

public record EvaluateTransferPolicyCommand(
        UUID policyId,
        String initiatedBy,
        UUID fromAccountId,
        UUID toAccountId,
        Money money,
        Map<Long, Long> velocityCounts) {

    public EvaluateTransferPolicyCommand {
        Objects.requireNonNull(policyId, "policyId");
        if (initiatedBy == null || initiatedBy.isBlank()) {
            throw new IllegalArgumentException("initiatedBy must not be blank");
        }
        Objects.requireNonNull(fromAccountId, "fromAccountId");
        Objects.requireNonNull(toAccountId, "toAccountId");
        Objects.requireNonNull(money, "money");
        velocityCounts = velocityCounts == null ? Map.of() : Map.copyOf(velocityCounts);
    }
}
