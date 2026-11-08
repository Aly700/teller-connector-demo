package dev.affan.teller.export;

import java.time.LocalDate;

public record DailyExportResult(
        LocalDate date,
        EntryExportResult entries,
        AuditExportResult audit) {
}
