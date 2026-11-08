package dev.affan.teller.web;

import dev.affan.teller.export.AuditExportResult;
import dev.affan.teller.export.AuditExportService;
import dev.affan.teller.export.DailyExportResult;
import dev.affan.teller.export.DailyExportService;
import java.time.LocalDate;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/admin/exports")
public class AdminExportController {

    private final AuditExportService auditExportService;
    private final DailyExportService dailyExportService;

    public AdminExportController(
            AuditExportService auditExportService,
            DailyExportService dailyExportService) {
        this.auditExportService = auditExportService;
        this.dailyExportService = dailyExportService;
    }

    @PostMapping("/audit")
    AuditExportResult exportAudit(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        return auditExportService.export(date);
    }

    @PostMapping("/daily")
    DailyExportResult exportDaily(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        return dailyExportService.export(date);
    }
}
