package dev.affan.teller.reconcile;

import dev.affan.teller.export.DailyExportResult;
import dev.affan.teller.export.DailyExportService;
import java.time.LocalDate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

@Component
public class ReconciliationJob {

    private final DailyExportService dailyExportService;
    private final ReconciliationService reconciliationService;

    public ReconciliationJob(
            DailyExportService dailyExportService,
            ReconciliationService reconciliationService) {
        this.dailyExportService = dailyExportService;
        this.reconciliationService = reconciliationService;
    }

    @Transactional(isolation = Isolation.REPEATABLE_READ)
    public ReconciliationRun run(LocalDate date) {
        DailyExportResult export = dailyExportService.export(date);
        return reconciliationService.reconcile(export);
    }
}
