package dev.affan.teller.reconcile;

import java.util.Optional;

public interface ReconciliationRunStore {

    ReconciliationRun storeReconciliationRun(ReconciliationRun run);

    Optional<ReconciliationRun> latestReconciliationRun();
}
