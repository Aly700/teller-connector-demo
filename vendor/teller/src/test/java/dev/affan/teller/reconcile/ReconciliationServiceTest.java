package dev.affan.teller.reconcile;

import static org.assertj.core.api.Assertions.assertThat;

import dev.affan.teller.domain.Account;
import dev.affan.teller.domain.AccountStore;
import dev.affan.teller.domain.AuditEventType;
import dev.affan.teller.domain.AuditRecord;
import dev.affan.teller.domain.AuditService;
import dev.affan.teller.domain.AuditStore;
import dev.affan.teller.domain.Entry;
import dev.affan.teller.domain.EntryDirection;
import dev.affan.teller.domain.EntryStore;
import dev.affan.teller.domain.Money;
import dev.affan.teller.export.AuditExportResult;
import dev.affan.teller.export.AuditObjectStore;
import dev.affan.teller.export.DailyExportResult;
import dev.affan.teller.export.EntryExportResult;
import dev.affan.teller.export.EntryExportRow;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

class ReconciliationServiceTest {

    private static final Instant NOW = Instant.parse("2026-08-29T03:00:00Z");
    private static final LocalDate DATE = LocalDate.of(2026, 8, 28);

    @Test
    void mismatchIsPersistedAuditedAndCounted() {
        ObjectMapper mapper = new ObjectMapper();
        UUID accountId = UUID.randomUUID();
        Account account = Account.open(accountId, "USD", NOW);
        account.deposit(Money.of(1_001, "USD"));
        List<Entry> entries = depositPosting(accountId, 1_000);
        byte[] exported = entries.stream()
                .map(EntryExportRow::from)
                .map(mapper::writeValueAsString)
                .reduce("", (jsonl, row) -> jsonl + row + "\n")
                .getBytes(StandardCharsets.UTF_8);
        CapturingObjectStore objects = new CapturingObjectStore(exported);
        InMemoryLedger ledger = new InMemoryLedger(account, entries);
        InMemoryAudits audits = new InMemoryAudits();
        InMemoryRuns runs = new InMemoryRuns();
        SimpleMeterRegistry meters = new SimpleMeterRegistry();
        ReconciliationService service = new ReconciliationService(
                ledger,
                ledger,
                objects,
                new ReconciliationComparator(),
                runs,
                new AuditService(audits, mapper, Clock.fixed(NOW, ZoneOffset.UTC)),
                meters,
                mapper,
                Clock.fixed(NOW, ZoneOffset.UTC));
        DailyExportResult export = new DailyExportResult(
                DATE,
                new EntryExportResult(DATE, "entries.jsonl", 2, Map.of()),
                new AuditExportResult(DATE, "audit.jsonl", 0));

        ReconciliationRun run = service.reconcile(export);

        assertThat(run.getStatus()).isEqualTo(ReconciliationStatus.MISMATCH);
        assertThat(runs.latestReconciliationRun()).containsSame(run);
        assertThat(audits.records)
                .extracting(AuditRecord::getEventType)
                .containsExactly(AuditEventType.RECONCILIATION_MISMATCH);
        assertThat(meters.counter("teller.reconciliation.mismatch").count()).isEqualTo(1.0);
        assertThat(run.getDetails()).contains("stored=1001", "entries=1000");
    }

    private static List<Entry> depositPosting(UUID accountId, long amountMinor) {
        UUID postingId = UUID.randomUUID();
        return List.of(
                Entry.create(UUID.randomUUID(), postingId, null, accountId,
                        EntryDirection.CREDIT, amountMinor, "USD", NOW),
                Entry.create(UUID.randomUUID(), postingId, null, null,
                        EntryDirection.DEBIT, amountMinor, "USD", NOW));
    }

    private static final class CapturingObjectStore implements AuditObjectStore {
        private final byte[] content;

        private CapturingObjectStore(byte[] content) {
            this.content = content;
        }

        @Override
        public void put(String objectKey, byte[] jsonLines) {
        }

        @Override
        public byte[] get(String objectKey) {
            return content;
        }
    }

    private static final class InMemoryLedger implements AccountStore, EntryStore {
        private final Account account;
        private final List<Entry> entries;

        private InMemoryLedger(Account account, List<Entry> entries) {
            this.account = account;
            this.entries = entries;
        }

        @Override public Account storeAccount(Account value) { throw new UnsupportedOperationException(); }
        @Override public Optional<Account> findAccountById(UUID id) { return Optional.ofNullable(
                account.getId().equals(id) ? account : null); }
        @Override public Optional<Account> findLockedAccountById(UUID id) { return findAccountById(id); }
        @Override public List<Account> findAllAccounts() { return List.of(account); }
        @Override public List<Entry> storeEntries(List<Entry> values) { throw new UnsupportedOperationException(); }
        @Override public List<Entry> findEntriesByTransferId(UUID id) { return List.of(); }
        @Override public List<Entry> findEntries(Instant from, Instant to) { return entries; }
        @Override public List<Entry> findAllEntries() { return entries; }
    }

    private static final class InMemoryAudits implements AuditStore {
        private final List<AuditRecord> records = new ArrayList<>();

        @Override public AuditRecord storeAuditRecord(AuditRecord record) { records.add(record); return record; }
        @Override public Optional<AuditRecord> findAuditRecordById(UUID id) { return records.stream()
                .filter(record -> record.getId().equals(id)).findFirst(); }
        @Override public List<AuditRecord> findAuditRecords(Instant from, Instant to) { return List.copyOf(records); }
    }

    private static final class InMemoryRuns implements ReconciliationRunStore {
        private final Map<UUID, ReconciliationRun> values = new LinkedHashMap<>();

        @Override public ReconciliationRun storeReconciliationRun(ReconciliationRun run) {
            values.put(run.getId(), run);
            return run;
        }

        @Override public Optional<ReconciliationRun> latestReconciliationRun() {
            return values.values().stream().reduce((first, second) -> second);
        }
    }
}
