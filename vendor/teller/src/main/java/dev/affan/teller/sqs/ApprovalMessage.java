package dev.affan.teller.sqs;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

public record ApprovalMessage(UUID messageId, UUID approvalId, UUID decisionId, Instant expiresAt) {

    public ApprovalMessage {
        Objects.requireNonNull(messageId, "messageId");
        Objects.requireNonNull(approvalId, "approvalId");
        Objects.requireNonNull(decisionId, "decisionId");
        Objects.requireNonNull(expiresAt, "expiresAt");
    }
}
