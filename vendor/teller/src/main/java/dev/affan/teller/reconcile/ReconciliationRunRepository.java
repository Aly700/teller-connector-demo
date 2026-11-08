package dev.affan.teller.reconcile;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ReconciliationRunRepository
        extends JpaRepository<ReconciliationRun, UUID>, ReconciliationRunStore {

    Optional<ReconciliationRun> findFirstByOrderByCompletedAtDescIdDesc();

    @Override
    default ReconciliationRun storeReconciliationRun(ReconciliationRun run) {
        return save(run);
    }

    @Override
    default Optional<ReconciliationRun> latestReconciliationRun() {
        return findFirstByOrderByCompletedAtDescIdDesc();
    }
}
