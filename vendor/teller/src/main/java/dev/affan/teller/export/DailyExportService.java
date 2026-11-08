package dev.affan.teller.export;

import java.time.LocalDate;
import java.util.UUID;
import org.springframework.stereotype.Service;

@Service
public class DailyExportService {

    private final EntryExportService entryExportService;
    private final AuditExportService auditExportService;

    public DailyExportService(
            EntryExportService entryExportService,
            AuditExportService auditExportService) {
        this.entryExportService = entryExportService;
        this.auditExportService = auditExportService;
    }

    public DailyExportResult export(LocalDate date) {
        String objectName = "run-" + UUID.randomUUID();
        EntryExportResult entries = entryExportService.export(date, objectName);
        AuditExportResult audit = auditExportService.export(date, objectName);
        return new DailyExportResult(date, entries, audit);
    }
}
