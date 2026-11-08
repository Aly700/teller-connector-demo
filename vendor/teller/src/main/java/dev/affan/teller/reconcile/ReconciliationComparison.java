package dev.affan.teller.reconcile;

import dev.affan.teller.export.EntryAmountTotals;
import java.util.List;
import java.util.Map;

public record ReconciliationComparison(
        boolean matched,
        List<String> mismatches,
        int databaseRowCount,
        int exportRowCount,
        Map<String, EntryAmountTotals> databaseTotals,
        Map<String, EntryAmountTotals> exportTotals) {

    public ReconciliationComparison {
        mismatches = List.copyOf(mismatches);
        databaseTotals = Map.copyOf(databaseTotals);
        exportTotals = Map.copyOf(exportTotals);
    }
}
