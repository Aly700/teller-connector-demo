package dev.affan.teller.web;

import dev.affan.teller.reconcile.ReconciliationJob;
import dev.affan.teller.reconcile.ReconciliationRun;
import dev.affan.teller.reconcile.ReconciliationService;
import java.time.LocalDate;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/admin/reconciliation")
public final class AdminReconciliationController {

    private final ReconciliationJob reconciliationJob;
    private final ReconciliationService reconciliationService;

    public AdminReconciliationController(
            ReconciliationJob reconciliationJob,
            ReconciliationService reconciliationService) {
        this.reconciliationJob = reconciliationJob;
        this.reconciliationService = reconciliationService;
    }

    @PostMapping
    ReconciliationRun run(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        return reconciliationJob.run(date);
    }

    @GetMapping("/latest")
    ReconciliationRun latest() {
        return reconciliationService.latest();
    }
}
