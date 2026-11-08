package dev.affan.teller.reconcile;

import static org.assertj.core.api.Assertions.assertThat;

import dev.affan.teller.domain.Account;
import dev.affan.teller.domain.Entry;
import dev.affan.teller.domain.EntryDirection;
import dev.affan.teller.domain.Money;
import dev.affan.teller.export.EntryExportRow;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class ReconciliationComparatorTest {

    private static final Instant NOW = Instant.parse("2026-08-29T00:00:00Z");

    @Test
    void matchingLedgerAndExportProduceNoMismatches() {
        UUID accountId = UUID.randomUUID();
        Account account = Account.open(accountId, "USD", NOW);
        account.deposit(Money.of(1_000, "USD"));
        List<Entry> allEntries = depositPosting(accountId, 1_000);
        List<EntryExportRow> exported = allEntries.stream().map(EntryExportRow::from).toList();

        ReconciliationComparison comparison = new ReconciliationComparator()
                .compare(List.of(account), allEntries, allEntries, exported);

        assertThat(comparison.matched()).isTrue();
        assertThat(comparison.mismatches()).isEmpty();
        assertThat(comparison.databaseRowCount()).isEqualTo(2);
        assertThat(comparison.exportRowCount()).isEqualTo(2);
    }

    @Test
    void seededBalanceAndExportMismatchReportsExactDifferences() {
        UUID accountId = UUID.randomUUID();
        Account account = Account.open(accountId, "USD", NOW);
        account.deposit(Money.of(1_001, "USD"));
        List<Entry> databaseEntries = depositPosting(accountId, 1_000);
        List<EntryExportRow> truncatedExport = databaseEntries.stream()
                .limit(1)
                .map(EntryExportRow::from)
                .toList();

        ReconciliationComparison comparison = new ReconciliationComparator()
                .compare(List.of(account), databaseEntries, databaseEntries, truncatedExport);

        assertThat(comparison.matched()).isFalse();
        assertThat(comparison.mismatches())
                .anySatisfy(value -> assertThat(value)
                        .contains("account", accountId.toString(), "stored=1001", "entries=1000"))
                .anySatisfy(value -> assertThat(value)
                        .contains("export row count", "database=2", "export=1"))
                .anySatisfy(value -> assertThat(value)
                        .contains("USD", "database", "export"));
    }

    @Test
    void equalTotalsCannotHideAChangedExportedEntry() {
        UUID accountId = UUID.randomUUID();
        Account account = Account.open(accountId, "USD", NOW);
        account.deposit(Money.of(1_000, "USD"));
        List<Entry> databaseEntries = depositPosting(accountId, 1_000);
        List<EntryExportRow> exported = new java.util.ArrayList<>(
                databaseEntries.stream().map(EntryExportRow::from).toList());
        EntryExportRow customerRow = exported.getFirst();
        exported.set(0, new EntryExportRow(
                customerRow.id(),
                customerRow.postingId(),
                customerRow.transferId(),
                UUID.randomUUID(),
                customerRow.direction(),
                customerRow.amountMinor(),
                customerRow.currency(),
                customerRow.createdAt()));

        ReconciliationComparison comparison = new ReconciliationComparator()
                .compare(List.of(account), databaseEntries, databaseEntries, exported);

        assertThat(comparison.matched()).isFalse();
        assertThat(comparison.mismatches()).contains("export entry rows differ from the database");
        assertThat(comparison.databaseTotals()).isEqualTo(comparison.exportTotals());
    }

    private static List<Entry> depositPosting(UUID accountId, long amountMinor) {
        UUID postingId = UUID.randomUUID();
        return List.of(
                Entry.create(UUID.randomUUID(), postingId, null, accountId,
                        EntryDirection.CREDIT, amountMinor, "USD", NOW),
                Entry.create(UUID.randomUUID(), postingId, null, null,
                        EntryDirection.DEBIT, amountMinor, "USD", NOW));
    }
}
