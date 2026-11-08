package dev.affan.teller.domain;

import static org.assertj.core.api.Assertions.assertThat;

import dev.affan.teller.sqs.ApprovalMessageValidator;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

class ApprovalServiceTest {

    private static final Instant NOW = Instant.parse("2026-08-29T15:30:00Z");

    @Test
    void persistsTheReviewReasonAndIncludesItInTheApprovalAuditRow() {
        Approval approval = Approval.pending(
                UUID.randomUUID(),
                UUID.randomUUID(),
                NOW.minusSeconds(60),
                NOW.plusSeconds(600));
        ApprovalMemoryStore approvals = new ApprovalMemoryStore(approval);
        AuditMemoryStore audit = new AuditMemoryStore();
        ApprovalService service = new ApprovalService(
                approvals,
                new AuditService(audit, new ObjectMapper(), Clock.fixed(NOW, ZoneOffset.UTC)),
                Clock.fixed(NOW, ZoneOffset.UTC),
                new ApprovalMessageValidator());

        Approval result = service.approve(
                approval.getId(),
                "console-reviewer",
                "  Verified against the ticket  ");

        assertThat(result.getReason()).isEqualTo("Verified against the ticket");
        assertThat(audit.records).singleElement().satisfies(record -> {
            assertThat(record.getEventType()).isEqualTo(AuditEventType.APPROVAL_APPROVED);
            assertThat(record.getDetails())
                    .contains("\"reason\":\"Verified against the ticket\"")
                    .contains("\"decidedBy\":\"console-reviewer\"");
        });
    }

    private static final class ApprovalMemoryStore implements ApprovalStore {
        private final Approval approval;

        private ApprovalMemoryStore(Approval approval) {
            this.approval = approval;
        }

        @Override
        public Approval storeApproval(Approval value) {
            return value;
        }

        @Override
        public Optional<Approval> findApprovalById(UUID id) {
            return approval.getId().equals(id) ? Optional.of(approval) : Optional.empty();
        }

        @Override
        public List<Approval> findApprovals(ApprovalStatus status) {
            return approval.getStatus() == status ? List.of(approval) : List.of();
        }

        @Override
        public List<Approval> findStaleApprovals(ApprovalStatus status, Instant expiresAt) {
            return List.of();
        }
    }

    private static final class AuditMemoryStore implements AuditStore {
        private final List<AuditRecord> records = new ArrayList<>();

        @Override
        public AuditRecord storeAuditRecord(AuditRecord record) {
            records.add(record);
            return record;
        }

        @Override
        public Optional<AuditRecord> findAuditRecordById(UUID id) {
            return records.stream().filter(record -> record.getId().equals(id)).findFirst();
        }

        @Override
        public List<AuditRecord> findAuditRecords(Instant from, Instant to) {
            return List.copyOf(records);
        }
    }
}
