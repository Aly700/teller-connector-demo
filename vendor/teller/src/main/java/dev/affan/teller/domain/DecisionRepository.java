package dev.affan.teller.domain;

import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface DecisionRepository extends JpaRepository<Decision, UUID>, DecisionStore {

    @Override
    default Decision storeDecision(Decision decision) {
        return save(decision);
    }

    @Override
    default java.util.Optional<Decision> findDecisionById(UUID id) {
        return findById(id);
    }
}
