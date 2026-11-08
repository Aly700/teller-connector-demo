package dev.affan.teller.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class ApprovalQueueServiceTest {

    @Test
    void joinsAPendingApprovalToItsHeldTransferAndMatchedRule() {
        Instant createdAt = Instant.parse("2026-08-29T15:00:00Z");
        UUID approvalId = UUID.randomUUID();
        UUID decisionId = UUID.randomUUID();
        UUID ruleId = UUID.randomUUID();
        Approval approval = Approval.pending(
                approvalId,
                decisionId,
                createdAt,
                createdAt.plusSeconds(1800));
        Transfer transfer = Transfer.pending(
                UUID.randomUUID(),
                "queue-test",
                UUID.randomUUID(),
                UUID.randomUUID(),
                Money.of(6_250, "USD"),
                decisionId,
                createdAt);
        transfer.hold(approvalId);
        Decision decision = Decision.create(
                decisionId,
                UUID.randomUUID(),
                1,
                "maker",
                "ledger.transfer",
                "{}",
                RiskTier.HIGH,
                ruleId,
                Effect.REQUIRE_APPROVAL,
                createdAt);
        Approval genericGateApproval = Approval.pending(
                UUID.randomUUID(),
                UUID.randomUUID(),
                createdAt.minusSeconds(1),
                createdAt.plusSeconds(1800));
        QueueStores stores = new QueueStores(approval, genericGateApproval, transfer, decision);
        ApprovalQueueService service = new ApprovalQueueService(stores, stores, stores);

        assertThat(service.findApprovals(ApprovalStatus.PENDING))
                .extracting(Approval::getId)
                .containsExactly(genericGateApproval.getId(), approvalId);
        assertThat(service.getTransfer(approvalId)).satisfies(details -> {
            assertThat(details.transferId()).isEqualTo(transfer.getId());
            assertThat(details.amountMinor()).isEqualTo(6_250);
            assertThat(details.currency()).isEqualTo("USD");
            assertThat(details.fromAccountId()).isEqualTo(transfer.getFromAccountId());
            assertThat(details.toAccountId()).isEqualTo(transfer.getToAccountId());
            assertThat(details.matchedRuleId()).isEqualTo(ruleId);
        });
    }

    private record QueueStores(
            Approval approval,
            Approval genericGateApproval,
            Transfer transfer,
            Decision decision)
            implements ApprovalStore, TransferStore, DecisionStore {

        @Override public Approval storeApproval(Approval value) { return value; }
        @Override public Optional<Approval> findApprovalById(UUID id) {
            if (approval.getId().equals(id)) return Optional.of(approval);
            return genericGateApproval.getId().equals(id) ? Optional.of(genericGateApproval) : Optional.empty();
        }
        @Override public List<Approval> findApprovals(ApprovalStatus status) {
            return status == ApprovalStatus.PENDING ? List.of(genericGateApproval, approval) : List.of();
        }
        @Override public List<Approval> findStaleApprovals(ApprovalStatus status, Instant expiresAt) {
            return List.of();
        }
        @Override public Transfer storeTransfer(Transfer value) { return value; }
        @Override public Optional<Transfer> findTransferById(UUID id) {
            return transfer.getId().equals(id) ? Optional.of(transfer) : Optional.empty();
        }
        @Override public Optional<Transfer> findTransferByApprovalId(UUID id) {
            return transfer.getApprovalId().equals(id) ? Optional.of(transfer) : Optional.empty();
        }
        @Override public Optional<Transfer> findLockedTransferById(UUID id) { return findTransferById(id); }
        @Override public Optional<Transfer> findLockedTransferByDecisionId(UUID id) {
            return transfer.getDecisionId().equals(id) ? Optional.of(transfer) : Optional.empty();
        }
        @Override public long countTransfers(UUID from, Instant since, TransferState excluded) { return 0; }
        @Override public List<Transfer> findAllTransfers() { return List.of(transfer); }
        @Override public Decision storeDecision(Decision value) { return value; }
        @Override public Optional<Decision> findDecisionById(UUID id) {
            return decision.getId().equals(id) ? Optional.of(decision) : Optional.empty();
        }
    }
}
