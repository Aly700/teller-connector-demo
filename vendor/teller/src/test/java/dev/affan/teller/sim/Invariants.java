package dev.affan.teller.sim;

import dev.affan.teller.domain.Account;
import dev.affan.teller.domain.Approval;
import dev.affan.teller.domain.ApprovalStatus;
import dev.affan.teller.domain.AuditEventType;
import dev.affan.teller.domain.AuditRecord;
import dev.affan.teller.domain.Decision;
import dev.affan.teller.domain.Effect;
import dev.affan.teller.domain.Entry;
import dev.affan.teller.domain.Transfer;
import dev.affan.teller.domain.TransferState;
import dev.affan.teller.sqs.OutboxMessage;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

final class Invariants {

    private final InMemoryStores stores;
    private final FaultInjectingBus bus;
    private final Set<UUID> everHeld = new LinkedHashSet<>();
    private final Set<UUID> everPosted = new LinkedHashSet<>();
    private final Map<UUID, TransferState> previousTransferStates = new LinkedHashMap<>();
    private final Map<UUID, Integer> heldReservationReleases = new LinkedHashMap<>();
    private List<AuditSnapshot> previousAudit = List.of();

    Invariants(InMemoryStores stores, FaultInjectingBus bus) {
        this.stores = stores;
        this.bus = bus;
    }

    void checkAfterStep() {
        observeTransferTransitions();
        requireEntriesConservedPerCurrency();
        requireEveryPostingBalanced();
        requireLedgerBalancesEqualEntries();
        requireAvailableBalancesEqualLedgerMinusReservations();
        requireNoNegativeAccounts();
        requireApprovalCardinality();
        requireIdempotentResults();
        requireAppendOnlyOrderedAudit();
        requireAtMostOneConsumerEffect();
    }

    void checkAfterQuiescence() {
        checkAfterStep();
        for (Transfer transfer : stores.transfers()) {
            require(
                    transfer.getState() == TransferState.POSTED
                            || transfer.getState() == TransferState.REVERSED
                            || transfer.getState() == TransferState.DENIED,
                    "transfer did not reach a terminal state: " + transfer.getId());
        }
        for (UUID transferId : everHeld) {
            Transfer transfer = stores.findTransferById(transferId).orElseThrow();
            require(
                    transfer.getState() == TransferState.POSTED
                            || transfer.getState() == TransferState.REVERSED,
                    "HELD transfer did not end POSTED or REVERSED: " + transferId);
            int releases = heldReservationReleases.getOrDefault(transferId, 0);
            int expected = everPosted.contains(transferId) ? 0 : 1;
            require(
                    releases == expected,
                    "HELD transfer reservation release count was " + releases
                            + " but expected " + expected + ": " + transferId);
        }
        for (Approval approval : stores.approvals()) {
            require(
                    approval.getStatus() == ApprovalStatus.APPROVED
                            || approval.getStatus() == ApprovalStatus.DENIED
                            || approval.getStatus() == ApprovalStatus.EXPIRED,
                    "approval did not reach a terminal state: " + approval.getId());
            long createdEvents = stores.auditRecords().stream()
                    .filter(record -> record.getAggregateId().equals(approval.getId()))
                    .filter(record -> record.getEventType() == AuditEventType.APPROVAL_CREATED)
                    .count();
            require(createdEvents == 1, "approval must have exactly one APPROVAL_CREATED audit event");
        }
        for (OutboxMessage message : stores.outboxMessages()) {
            require(message.getSentAt() != null, "outbox row was not eventually sent: " + message.getId());
            require(
                    bus.effectCounts().getOrDefault(message.getId(), 0) == 1,
                    "outbox row did not produce exactly one consumer effect: " + message.getId());
            require(
                    stores.processedMessageIds().contains(message.getId().toString()),
                    "outbox row was not claimed by the idempotent consumer: " + message.getId());
        }
        require(bus.pendingMessages() == 0, "message bus did not quiesce");
    }

    private void observeTransferTransitions() {
        for (Transfer transfer : stores.transfers()) {
            TransferState current = transfer.getState();
            TransferState previous = previousTransferStates.put(transfer.getId(), current);
            if (current == TransferState.HELD) {
                everHeld.add(transfer.getId());
            }
            if (current == TransferState.POSTED) {
                everPosted.add(transfer.getId());
            }
            if (previous == TransferState.HELD && current == TransferState.REVERSED) {
                heldReservationReleases.merge(transfer.getId(), 1, Integer::sum);
            }
        }
    }

    private void requireEntriesConservedPerCurrency() {
        Map<String, Long> totals = new LinkedHashMap<>();
        stores.entries().forEach(entry -> totals.merge(
                entry.getCurrency(), entry.signedAmountMinor(), Math::addExact));
        totals.forEach((currency, total) -> require(
                total == 0,
                "entries are not conserved for " + currency + ": " + total));
    }

    private void requireEveryPostingBalanced() {
        Map<UUID, Long> totals = new LinkedHashMap<>();
        Map<UUID, Integer> counts = new LinkedHashMap<>();
        Map<UUID, Set<String>> currencies = new LinkedHashMap<>();
        for (Entry entry : stores.entries()) {
            totals.merge(entry.getPostingId(), entry.signedAmountMinor(), Math::addExact);
            counts.merge(entry.getPostingId(), 1, Integer::sum);
            currencies.computeIfAbsent(entry.getPostingId(), ignored -> new HashSet<>())
                    .add(entry.getCurrency());
        }
        totals.forEach((postingId, total) -> {
            require(total == 0, "posting is not balanced: " + postingId + " total=" + total);
            require(counts.get(postingId) >= 2, "posting has fewer than two entries: " + postingId);
            require(currencies.get(postingId).size() == 1, "posting mixes currencies: " + postingId);
        });
    }

    private void requireLedgerBalancesEqualEntries() {
        Map<UUID, Long> balances = new HashMap<>();
        stores.entries().stream()
                .filter(entry -> entry.getAccountId() != null)
                .forEach(entry -> balances.merge(
                        entry.getAccountId(), entry.signedAmountMinor(), Math::addExact));
        for (Account account : stores.accounts()) {
            long fromEntries = balances.getOrDefault(account.getId(), 0L);
            require(
                    account.getLedgerBalanceMinor() == fromEntries,
                    "account ledger differs from entries: " + account.getId()
                            + " ledger=" + account.getLedgerBalanceMinor()
                            + " entries=" + fromEntries);
        }
    }

    private void requireAvailableBalancesEqualLedgerMinusReservations() {
        Map<UUID, Long> reservations = new HashMap<>();
        stores.transfers().stream()
                .filter(transfer -> transfer.getState() == TransferState.HELD)
                .forEach(transfer -> reservations.merge(
                        transfer.getFromAccountId(), transfer.getAmountMinor(), Math::addExact));
        for (Account account : stores.accounts()) {
            long expected = Math.subtractExact(
                    account.getLedgerBalanceMinor(),
                    reservations.getOrDefault(account.getId(), 0L));
            require(
                    account.getAvailableBalanceMinor() == expected,
                    "account available balance differs from ledger minus reservations: "
                            + account.getId() + " available=" + account.getAvailableBalanceMinor()
                            + " expected=" + expected);
        }
    }

    private void requireNoNegativeAccounts() {
        stores.accounts().forEach(account -> {
            require(account.getLedgerBalanceMinor() >= 0, "negative ledger balance: " + account.getId());
            require(account.getAvailableBalanceMinor() >= 0, "negative available balance: " + account.getId());
        });
    }

    private void requireApprovalCardinality() {
        Map<UUID, Long> approvalCounts = new HashMap<>();
        stores.approvals().forEach(approval -> approvalCounts.merge(approval.getDecisionId(), 1L, Long::sum));
        for (Decision decision : stores.decisions()) {
            long count = approvalCounts.getOrDefault(decision.getId(), 0L);
            require(count <= 1, "decision has more than one approval: " + decision.getId());
            if (decision.getEffect() != Effect.REQUIRE_APPROVAL) {
                require(count == 0, "non-approval decision unexpectedly has an approval: " + decision.getId());
            }
        }
        for (Transfer transfer : stores.transfers()) {
            if (transfer.getApprovalId() != null) {
                require(
                        approvalCounts.getOrDefault(transfer.getDecisionId(), 0L) == 1,
                        "transfer approval is not linked to its decision: " + transfer.getId());
            }
        }
    }

    private void requireIdempotentResults() {
        stores.decisionResultsByKey().forEach((key, ids) -> require(
                new HashSet<>(ids).size() <= 1,
                "idempotency key created more than one decision: " + key));
        stores.transferResultsByKey().forEach((key, ids) -> require(
                new HashSet<>(ids).size() <= 1,
                "idempotency key created more than one transfer: " + key));
        stores.transferEntryCountsByKey().forEach((key, counts) -> require(
                new HashSet<>(counts).size() <= 1,
                "idempotent replay changed transfer entries: " + key + " counts=" + counts));
    }

    private void requireAppendOnlyOrderedAudit() {
        List<AuditSnapshot> current = stores.auditRecords().stream().map(AuditSnapshot::from).toList();
        require(current.size() >= previousAudit.size(), "audit log shrank");
        require(
                current.subList(0, previousAudit.size()).equals(previousAudit),
                "an existing audit record was changed or reordered");
        Set<UUID> ids = new HashSet<>();
        Map<Aggregate, Instant> lastTimestamp = new HashMap<>();
        for (AuditSnapshot record : current) {
            require(ids.add(record.id()), "duplicate audit record id: " + record.id());
            Aggregate aggregate = new Aggregate(record.aggregateType(), record.aggregateId());
            Instant previous = lastTimestamp.put(aggregate, record.occurredAt());
            require(
                    previous == null || !record.occurredAt().isBefore(previous),
                    "audit records are not ordered for aggregate " + aggregate);
        }
        previousAudit = new ArrayList<>(current);
    }

    private void requireAtMostOneConsumerEffect() {
        bus.effectCounts().forEach((messageId, count) -> require(
                count <= 1,
                "duplicate consumer effect for message " + messageId));
    }

    private static void require(boolean condition, String message) {
        if (!condition) {
            throw new AssertionError(message);
        }
    }

    private record Aggregate(String type, UUID id) {
    }

    private record AuditSnapshot(
            UUID id,
            AuditEventType eventType,
            String aggregateType,
            UUID aggregateId,
            Instant occurredAt,
            String details) {

        static AuditSnapshot from(AuditRecord record) {
            return new AuditSnapshot(
                    record.getId(),
                    record.getEventType(),
                    record.getAggregateType(),
                    record.getAggregateId(),
                    record.getOccurredAt(),
                    record.getDetails());
        }
    }
}
