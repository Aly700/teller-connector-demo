package dev.affan.teller.reconcile;

import java.time.Clock;
import java.time.LocalDate;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name = "teller.export.enabled", havingValue = "true")
public class ReconciliationScheduler {

    private final ReconciliationJob reconciliationJob;
    private final Clock clock;

    public ReconciliationScheduler(ReconciliationJob reconciliationJob, Clock clock) {
        this.reconciliationJob = reconciliationJob;
        this.clock = clock;
    }

    @Scheduled(cron = "${teller.export.cron:0 5 0 * * *}", zone = "UTC")
    public ReconciliationRun exportAndReconcilePreviousUtcDay() {
        return reconciliationJob.run(LocalDate.now(clock).minusDays(1));
    }
}
