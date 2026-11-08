package dev.affan.teller.export;

import java.time.LocalDate;
import java.util.Map;

public record EntryExportResult(
        LocalDate date,
        String objectKey,
        int recordCount,
        Map<String, EntryAmountTotals> totals) {

    public EntryExportResult {
        totals = Map.copyOf(totals);
    }
}
