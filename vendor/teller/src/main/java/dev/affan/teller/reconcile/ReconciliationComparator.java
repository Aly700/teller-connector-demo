package dev.affan.teller.reconcile;

import dev.affan.teller.domain.Account;
import dev.affan.teller.domain.Entry;
import dev.affan.teller.export.EntryAmountTotals;
import dev.affan.teller.export.EntryExportRow;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Component;

@Component
public class ReconciliationComparator {

    public ReconciliationComparison compare(
            List<Account> accounts,
            List<Entry> allEntries,
            List<Entry> databaseDayEntries,
            List<EntryExportRow> exportDayEntries) {
        List<String> mismatches = new ArrayList<>();
        compareAccountBalances(accounts, allEntries, mismatches);

        Map<String, EntryAmountTotals> databaseTotals = entryTotals(databaseDayEntries);
        Map<String, EntryAmountTotals> exportTotals = exportTotals(exportDayEntries);
        if (!sameRows(databaseDayEntries, exportDayEntries)) {
            mismatches.add("export entry rows differ from the database");
        }
        if (databaseDayEntries.size() != exportDayEntries.size()) {
            mismatches.add("export row count differs: database=%d export=%d".formatted(
                    databaseDayEntries.size(), exportDayEntries.size()));
        }
        Set<String> currencies = new LinkedHashSet<>(databaseTotals.keySet());
        currencies.addAll(exportTotals.keySet());
        for (String currency : currencies) {
            EntryAmountTotals database = databaseTotals.getOrDefault(currency, EntryAmountTotals.zero());
            EntryAmountTotals exported = exportTotals.getOrDefault(currency, EntryAmountTotals.zero());
            if (!database.equals(exported)) {
                mismatches.add("%s amount totals differ: database=%s export=%s"
                        .formatted(currency, database, exported));
            }
        }
        return new ReconciliationComparison(
                mismatches.isEmpty(),
                mismatches,
                databaseDayEntries.size(),
                exportDayEntries.size(),
                databaseTotals,
                exportTotals);
    }

    private static boolean sameRows(
            List<Entry> databaseEntries,
            List<EntryExportRow> exportedEntries) {
        if (databaseEntries.size() != exportedEntries.size()) {
            return false;
        }
        Map<UUID, EntryExportRow> databaseById = new HashMap<>();
        databaseEntries.stream().map(EntryExportRow::from).forEach(row -> databaseById.put(row.id(), row));
        Map<UUID, EntryExportRow> exportById = new HashMap<>();
        for (EntryExportRow row : exportedEntries) {
            if (exportById.put(row.id(), row) != null) {
                return false;
            }
        }
        return databaseById.equals(exportById);
    }

    private static void compareAccountBalances(
            List<Account> accounts,
            List<Entry> entries,
            List<String> mismatches) {
        Map<UUID, Long> entryBalances = new HashMap<>();
        Map<UUID, Set<String>> entryCurrencies = new HashMap<>();
        for (Entry entry : entries) {
            if (entry.getAccountId() == null) {
                continue;
            }
            entryBalances.merge(entry.getAccountId(), entry.signedAmountMinor(), Math::addExact);
            entryCurrencies.computeIfAbsent(entry.getAccountId(), ignored -> new LinkedHashSet<>())
                    .add(entry.getCurrency());
        }
        for (Account account : accounts) {
            long fromEntries = entryBalances.getOrDefault(account.getId(), 0L);
            Set<String> currencies = entryCurrencies.getOrDefault(account.getId(), Set.of());
            if (!currencies.isEmpty() && !currencies.equals(Set.of(account.getCurrency()))) {
                mismatches.add("account %s currency differs: stored=%s entries=%s"
                        .formatted(account.getId(), account.getCurrency(), currencies));
            }
            if (account.getLedgerBalanceMinor() != fromEntries) {
                mismatches.add("account %s ledger differs: stored=%d entries=%d"
                        .formatted(account.getId(), account.getLedgerBalanceMinor(), fromEntries));
            }
        }
    }

    private static Map<String, EntryAmountTotals> entryTotals(List<Entry> entries) {
        Map<String, EntryAmountTotals> totals = new LinkedHashMap<>();
        for (Entry entry : entries) {
            totals.compute(
                    entry.getCurrency(),
                    (currency, current) -> (current == null ? EntryAmountTotals.zero() : current)
                            .add(entry.getDirection(), entry.getAmountMinor()));
        }
        return Map.copyOf(totals);
    }

    private static Map<String, EntryAmountTotals> exportTotals(List<EntryExportRow> entries) {
        Map<String, EntryAmountTotals> totals = new LinkedHashMap<>();
        for (EntryExportRow entry : entries) {
            totals.compute(
                    entry.currency(),
                    (currency, current) -> (current == null ? EntryAmountTotals.zero() : current)
                            .add(entry.direction(), entry.amountMinor()));
        }
        return Map.copyOf(totals);
    }
}
