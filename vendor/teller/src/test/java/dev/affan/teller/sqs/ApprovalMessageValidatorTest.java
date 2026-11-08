package dev.affan.teller.sqs;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.affan.teller.domain.Approval;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class ApprovalMessageValidatorTest {

    private static final Instant CREATED_AT = Instant.parse("2026-08-28T12:00:00Z");
    private static final Instant EXPIRES_AT = Instant.parse("2026-08-28T12:30:00Z");
    private final ApprovalMessageValidator validator = new ApprovalMessageValidator();

    @Test
    void acceptsAMessageThatMatchesThePersistedApproval() {
        UUID approvalId = UUID.randomUUID();
        UUID decisionId = UUID.randomUUID();
        Approval approval = Approval.pending(approvalId, decisionId, CREATED_AT, EXPIRES_AT);
        ApprovalMessage message = new ApprovalMessage(UUID.randomUUID(), approvalId, decisionId, EXPIRES_AT);

        assertThatCode(() -> validator.validate(message, approval)).doesNotThrowAnyException();
    }

    @Test
    void rejectsAMessageForAnotherDecision() {
        UUID approvalId = UUID.randomUUID();
        Approval approval = Approval.pending(approvalId, UUID.randomUUID(), CREATED_AT, EXPIRES_AT);
        ApprovalMessage message = new ApprovalMessage(
                UUID.randomUUID(), approvalId, UUID.randomUUID(), EXPIRES_AT);

        assertThatThrownBy(() -> validator.validate(message, approval))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("decisionId");
    }

    @Test
    void rejectsAMessageWithATamperedExpiry() {
        UUID approvalId = UUID.randomUUID();
        UUID decisionId = UUID.randomUUID();
        Approval approval = Approval.pending(approvalId, decisionId, CREATED_AT, EXPIRES_AT);
        ApprovalMessage message = new ApprovalMessage(
                UUID.randomUUID(), approvalId, decisionId, EXPIRES_AT.plusSeconds(1));

        assertThatThrownBy(() -> validator.validate(message, approval))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("expiresAt");
    }
}
