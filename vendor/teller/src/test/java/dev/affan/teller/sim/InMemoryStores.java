package dev.affan.teller.sim;

import dev.affan.teller.domain.Approval;
import dev.affan.teller.domain.ApprovalStatus;
import dev.affan.teller.domain.ApprovalStore;
import dev.affan.teller.domain.Account;
import dev.affan.teller.domain.AccountStore;
import dev.affan.teller.domain.AuditRecord;
import dev.affan.teller.domain.AuditStore;
import dev.affan.teller.domain.Decision;
import dev.affan.teller.domain.DecisionOutcome;
import dev.affan.teller.domain.DecisionStore;
import dev.affan.teller.domain.Entry;
import dev.affan.teller.domain.EntryStore;
import dev.affan.teller.domain.IdempotencyRecord;
import dev.affan.teller.domain.IdempotencyStore;
import dev.affan.teller.domain.Policy;
import dev.affan.teller.domain.PolicyStore;
import dev.affan.teller.domain.Rule;
import dev.affan.teller.domain.RuleStore;
import dev.affan.teller.domain.Transfer;
import dev.affan.teller.domain.TransferState;
import dev.affan.teller.domain.TransferStore;
import dev.affan.teller.sqs.OutboxMessage;
import dev.affan.teller.sqs.OutboxStore;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Supplier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.SimpleTransactionStatus;

final class InMemoryStores
        implements AccountStore,
        TransferStore,
        EntryStore,
        IdempotencyStore,
        PolicyStore,
        RuleStore,
        DecisionStore,
        ApprovalStore,
        AuditStore,
        OutboxStore {

    private final Trace trace;
    private final InstantSource now;
    private final Map<UUID, Account> accounts = new LinkedHashMap<>();
    private final Map<UUID, Transfer> transfers = new LinkedHashMap<>();
    private final Map<UUID, Entry> entries = new LinkedHashMap<>();
    private final Map<String, IdempotencyRecord> idempotencyRecords = new LinkedHashMap<>();
    private final Map<UUID, Policy> policies = new LinkedHashMap<>();
    private final Map<UUID, Rule> rules = new LinkedHashMap<>();
    private final Map<UUID, Decision> decisions = new LinkedHashMap<>();
    private final Map<UUID, Approval> approvals = new LinkedHashMap<>();
    private final Map<UUID, AuditRecord> auditRecords = new LinkedHashMap<>();
    private final Map<UUID, OutboxMessage> outboxMessages = new LinkedHashMap<>();
    private final Set<String> processedMessageIds = new LinkedHashSet<>();
    private final Map<String, DecisionOutcome> idempotentOutcomes = new LinkedHashMap<>();
    private final Map<String, List<UUID>> decisionResultsByKey = new LinkedHashMap<>();
    private final Map<String, List<UUID>> transferResultsByKey = new LinkedHashMap<>();
    private final Map<String, List<Integer>> transferEntryCountsByKey = new LinkedHashMap<>();

    InMemoryStores(Trace trace, InstantSource now) {
        this.trace = trace;
        this.now = now;
    }

    PolicyStore policyStore() {
        return this;
    }

    RuleStore ruleStore() {
        return this;
    }

    DecisionStore decisionStore() {
        return this;
    }

    ApprovalStore approvalStore() {
        return this;
    }

    AuditStore auditStore() {
        return this;
    }

    OutboxStore outboxStore() {
        return this;
    }

    AccountStore accountStore() {
        return this;
    }

    TransferStore transferStore() {
        return this;
    }

    EntryStore entryStore() {
        return this;
    }

    IdempotencyStore idempotencyStore() {
        return this;
    }

    void seedPolicy(Policy policy) {
        policies.put(policy.getId(), policy);
    }

    void seedRule(Rule rule) {
        rules.put(rule.getId(), rule);
    }

    Collection<Decision> decisions() {
        return List.copyOf(decisions.values());
    }

    Collection<Account> accounts() {
        return List.copyOf(accounts.values());
    }

    Collection<Transfer> transfers() {
        return List.copyOf(transfers.values());
    }

    List<Entry> entries() {
        return List.copyOf(entries.values());
    }

    Collection<Approval> approvals() {
        return List.copyOf(approvals.values());
    }

    List<AuditRecord> auditRecords() {
        return List.copyOf(auditRecords.values());
    }

    Collection<OutboxMessage> outboxMessages() {
        return List.copyOf(outboxMessages.values());
    }

    Set<String> processedMessageIds() {
        return Set.copyOf(processedMessageIds);
    }

    Map<String, List<UUID>> decisionResultsByKey() {
        Map<String, List<UUID>> copy = new LinkedHashMap<>();
        decisionResultsByKey.forEach((key, ids) -> copy.put(key, List.copyOf(ids)));
        return copy;
    }

    Map<String, List<UUID>> transferResultsByKey() {
        Map<String, List<UUID>> copy = new LinkedHashMap<>();
        transferResultsByKey.forEach((key, ids) -> copy.put(key, List.copyOf(ids)));
        return copy;
    }

    Map<String, List<Integer>> transferEntryCountsByKey() {
        Map<String, List<Integer>> copy = new LinkedHashMap<>();
        transferEntryCountsByKey.forEach((key, counts) -> copy.put(key, List.copyOf(counts)));
        return copy;
    }

    void recordTransferIdempotencyResult(String key, Transfer transfer, Instant at, boolean replay) {
        trace.record(at, (replay ? "transfer-idempotency-replay key=" : "transfer-idempotency-claim key=")
                + key + " transfer=" + transfer.getId());
        transferResultsByKey.computeIfAbsent(key, ignored -> new ArrayList<>()).add(transfer.getId());
        UUID transferId = transfer.getId();
        int entryCount = (int) entries.values().stream()
                .filter(entry -> transferId.equals(entry.getTransferId()))
                .count();
        transferEntryCountsByKey.computeIfAbsent(key, ignored -> new ArrayList<>()).add(entryCount);
    }

    DecisionOutcome evaluateIdempotently(String key, Supplier<DecisionOutcome> operation, Instant at) {
        DecisionOutcome outcome = idempotentOutcomes.get(key);
        if (outcome == null) {
            outcome = operation.get();
            idempotentOutcomes.put(key, outcome);
            trace.record(at, "idempotency-claim key=" + key + " decision=" + outcome.decision().getId());
        } else {
            trace.record(at, "idempotency-replay key=" + key + " decision=" + outcome.decision().getId());
        }
        decisionResultsByKey.computeIfAbsent(key, ignored -> new ArrayList<>())
                .add(outcome.decision().getId());
        return outcome;
    }

    JdbcTemplate processedMessagesJdbc(InstantSource clock) {
        return new JdbcTemplate() {
            @Override
            public int update(String sql, Object... args) {
                String messageId = (String) args[0];
                boolean inserted = processedMessageIds.add(messageId);
                trace.record(clock.instant(), (inserted ? "processed-claim " : "processed-duplicate ") + messageId);
                return inserted ? 1 : 0;
            }
        };
    }

    PlatformTransactionManager transactionManager() {
        return new PlatformTransactionManager() {
            @Override
            public TransactionStatus getTransaction(TransactionDefinition definition) {
                return new SnapshotTransactionStatus(processedMessageIds);
            }

            @Override
            public void commit(TransactionStatus status) {
            }

            @Override
            public void rollback(TransactionStatus status) {
                SnapshotTransactionStatus snapshot = (SnapshotTransactionStatus) status;
                processedMessageIds.clear();
                processedMessageIds.addAll(snapshot.processedMessageIds());
            }
        };
    }

    @Override
    public int insertClaim(String key, String requestHash, Instant createdAt) {
        if (idempotencyRecords.containsKey(key)) {
            return 0;
        }
        idempotencyRecords.put(key, IdempotencyRecord.claim(key, requestHash, createdAt));
        trace.record(now.instant(), "idempotency-record-claimed key=" + key);
        return 1;
    }

    @Override
    public Optional<IdempotencyRecord> findLockedByKey(String key) {
        return Optional.ofNullable(idempotencyRecords.get(key));
    }

    @Override
    public int deleteExpiredKey(String key, Instant cutoff) {
        IdempotencyRecord record = idempotencyRecords.get(key);
        if (record != null && record.getCreatedAt().isBefore(cutoff)) {
            idempotencyRecords.remove(key);
            return 1;
        }
        return 0;
    }

    @Override
    public int deleteExpired(Instant cutoff) {
        int before = idempotencyRecords.size();
        idempotencyRecords.values().removeIf(record -> record.getCreatedAt().isBefore(cutoff));
        return before - idempotencyRecords.size();
    }

    @Override
    public void flushAndRefresh(IdempotencyRecord record) {
    }

    @Override
    public Account storeAccount(Account account) {
        accounts.put(account.getId(), account);
        trace.record(now.instant(), "account-saved id=" + account.getId());
        return account;
    }

    @Override
    public Optional<Account> findAccountById(UUID id) {
        return Optional.ofNullable(accounts.get(id));
    }

    @Override
    public Optional<Account> findLockedAccountById(UUID id) {
        return findAccountById(id);
    }

    @Override
    public List<Account> findAllAccounts() {
        return List.copyOf(accounts.values());
    }

    @Override
    public Transfer storeTransfer(Transfer transfer) {
        boolean duplicateKey = transfers.values().stream()
                .anyMatch(existing -> existing.getIdempotencyKey().equals(transfer.getIdempotencyKey())
                        && !existing.getId().equals(transfer.getId()));
        if (duplicateKey) {
            throw new IllegalStateException("transfer idempotency key already exists");
        }
        transfers.put(transfer.getId(), transfer);
        trace.record(now.instant(), "transfer-saved id=" + transfer.getId());
        return transfer;
    }

    @Override
    public Optional<Transfer> findTransferById(UUID id) {
        return Optional.ofNullable(transfers.get(id));
    }

    @Override
    public Optional<Transfer> findTransferByApprovalId(UUID approvalId) {
        return transfers.values().stream()
                .filter(transfer -> approvalId.equals(transfer.getApprovalId()))
                .findFirst();
    }

    @Override
    public Optional<Transfer> findLockedTransferById(UUID id) {
        return findTransferById(id);
    }

    @Override
    public Optional<Transfer> findLockedTransferByDecisionId(UUID decisionId) {
        return transfers.values().stream()
                .filter(transfer -> transfer.getDecisionId().equals(decisionId))
                .findFirst();
    }

    @Override
    public long countTransfers(UUID fromAccountId, Instant createdAt, TransferState excludedState) {
        return transfers.values().stream()
                .filter(transfer -> transfer.getFromAccountId().equals(fromAccountId))
                .filter(transfer -> !transfer.getCreatedAt().isBefore(createdAt))
                .filter(transfer -> transfer.getState() != excludedState)
                .count();
    }

    @Override
    public List<Transfer> findAllTransfers() {
        return List.copyOf(transfers.values());
    }

    @Override
    public List<Entry> storeEntries(List<Entry> values) {
        values.forEach(entry -> {
            if (entries.putIfAbsent(entry.getId(), entry) != null) {
                throw new IllegalStateException("entry already exists: " + entry.getId());
            }
            trace.record(now.instant(), "entry-saved id=" + entry.getId()
                    + " posting=" + entry.getPostingId());
        });
        return List.copyOf(values);
    }

    @Override
    public List<Entry> findEntriesByTransferId(UUID transferId) {
        return entries.values().stream()
                .filter(entry -> transferId.equals(entry.getTransferId()))
                .sorted(Comparator.comparing(Entry::getCreatedAt).thenComparing(Entry::getId))
                .toList();
    }

    @Override
    public List<Entry> findEntries(Instant from, Instant to) {
        return entries.values().stream()
                .filter(entry -> !entry.getCreatedAt().isBefore(from))
                .filter(entry -> entry.getCreatedAt().isBefore(to))
                .sorted(Comparator.comparing(Entry::getCreatedAt).thenComparing(Entry::getId))
                .toList();
    }

    @Override
    public List<Entry> findAllEntries() {
        return entries.values().stream()
                .sorted(Comparator.comparing(Entry::getCreatedAt).thenComparing(Entry::getId))
                .toList();
    }

    @Override
    public Policy storePolicy(Policy policy) {
        policies.put(policy.getId(), policy);
        trace.record(now.instant(), "policy-saved id=" + policy.getId());
        return policy;
    }

    @Override
    public boolean policyNameAndVersionExists(String name, int version) {
        return policies.values().stream()
                .anyMatch(policy -> policy.getName().equals(name) && policy.getVersion() == version);
    }

    @Override
    public int deactivateAllPolicies() {
        int deactivated = 0;
        for (Policy policy : policies.values()) {
            if (policy.isActive()) {
                policy.deactivate();
                deactivated++;
            }
        }
        return deactivated;
    }

    @Override
    public Optional<Policy> findPolicyById(UUID id) {
        return Optional.ofNullable(policies.get(id));
    }

    @Override
    public Optional<Policy> findActivePolicy() {
        return policies.values().stream()
                .filter(Policy::isActive)
                .max(Comparator.comparing(Policy::getCreatedAt).thenComparing(Policy::getId));
    }

    @Override
    public Rule storeRule(Rule rule) {
        rules.put(rule.getId(), rule);
        trace.record(now.instant(), "rule-saved id=" + rule.getId());
        return rule;
    }

    @Override
    public List<Rule> findRulesByPolicyId(UUID policyId) {
        return rules.values().stream()
                .filter(rule -> rule.getPolicyId().equals(policyId))
                .sorted(Comparator.comparingInt(Rule::getPrecedence).thenComparing(Rule::getId))
                .toList();
    }

    @Override
    public Decision storeDecision(Decision decision) {
        decisions.put(decision.getId(), decision);
        trace.record(now.instant(), "decision-saved id=" + decision.getId());
        return decision;
    }

    @Override
    public Optional<Decision> findDecisionById(UUID id) {
        return Optional.ofNullable(decisions.get(id));
    }

    @Override
    public Approval storeApproval(Approval approval) {
        boolean decisionAlreadyHasApproval = approvals.values().stream()
                .anyMatch(existing -> existing.getDecisionId().equals(approval.getDecisionId()));
        if (decisionAlreadyHasApproval) {
            throw new IllegalStateException("decision already has an approval");
        }
        approvals.put(approval.getId(), approval);
        trace.record(now.instant(), "approval-saved id=" + approval.getId());
        return approval;
    }

    @Override
    public Optional<Approval> findApprovalById(UUID id) {
        return Optional.ofNullable(approvals.get(id));
    }

    @Override
    public List<Approval> findApprovals(ApprovalStatus status) {
        return approvals.values().stream()
                .filter(approval -> approval.getStatus() == status)
                .sorted(Comparator.comparing(Approval::getCreatedAt).thenComparing(Approval::getId))
                .toList();
    }

    @Override
    public List<Approval> findStaleApprovals(ApprovalStatus status, Instant expiresAt) {
        return approvals.values().stream()
                .filter(approval -> approval.getStatus() == status)
                .filter(approval -> !approval.getExpiresAt().isAfter(expiresAt))
                .sorted(Comparator.comparing(Approval::getExpiresAt).thenComparing(Approval::getId))
                .toList();
    }

    @Override
    public AuditRecord storeAuditRecord(AuditRecord record) {
        if (auditRecords.putIfAbsent(record.getId(), record) != null) {
            throw new IllegalStateException("audit record already exists: " + record.getId());
        }
        trace.record(now.instant(), "audit-appended event=" + record.getEventType()
                + " aggregate=" + record.getAggregateId());
        return record;
    }

    @Override
    public Optional<AuditRecord> findAuditRecordById(UUID id) {
        return Optional.ofNullable(auditRecords.get(id));
    }

    @Override
    public List<AuditRecord> findAuditRecords(Instant from, Instant to) {
        return auditRecords.values().stream()
                .filter(record -> !record.getOccurredAt().isBefore(from))
                .filter(record -> record.getOccurredAt().isBefore(to))
                .sorted(Comparator.comparing(AuditRecord::getOccurredAt).thenComparing(AuditRecord::getId).reversed())
                .toList();
    }

    @Override
    public OutboxMessage storeOutboxMessage(OutboxMessage message) {
        outboxMessages.put(message.getId(), message);
        trace.record(now.instant(), "outbox-saved id=" + message.getId());
        return message;
    }

    @Override
    public List<OutboxMessage> lockPendingBatch(int batchSize) {
        return outboxMessages.values().stream()
                .filter(message -> message.getSentAt() == null)
                .sorted(Comparator.comparing(OutboxMessage::getCreatedAt).thenComparing(OutboxMessage::getId))
                .limit(batchSize)
                .toList();
    }

    @FunctionalInterface
    interface InstantSource {
        Instant instant();
    }

    private static final class SnapshotTransactionStatus extends SimpleTransactionStatus {

        private final Set<String> processedMessageIds;

        private SnapshotTransactionStatus(Set<String> processedMessageIds) {
            this.processedMessageIds = Set.copyOf(processedMessageIds);
        }

        Set<String> processedMessageIds() {
            return processedMessageIds;
        }
    }
}
