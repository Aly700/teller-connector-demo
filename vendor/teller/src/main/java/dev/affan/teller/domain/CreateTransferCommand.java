package dev.affan.teller.domain;

import java.util.Objects;
import java.util.UUID;

public record CreateTransferCommand(
        String idempotencyKey,
        UUID fromAccountId,
        UUID toAccountId,
        Money money,
        String initiatedBy) {

    public CreateTransferCommand {
        if (idempotencyKey == null || idempotencyKey.isBlank()) {
            throw new IllegalArgumentException("idempotencyKey must not be blank");
        }
        Objects.requireNonNull(fromAccountId, "fromAccountId");
        Objects.requireNonNull(toAccountId, "toAccountId");
        Objects.requireNonNull(money, "money");
        if (initiatedBy == null || initiatedBy.isBlank()) {
            throw new IllegalArgumentException("initiatedBy must not be blank");
        }
    }
}
