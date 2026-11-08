package dev.affan.teller.domain;

import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

public interface PolicyRepository extends JpaRepository<Policy, UUID>, PolicyStore {
    boolean existsByNameAndVersion(String name, int version);

    java.util.Optional<Policy> findFirstByActiveTrueOrderByCreatedAtDescIdAsc();

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("update Policy policy set policy.active = false where policy.active = true")
    int deactivateAll();

    @Override
    default Policy storePolicy(Policy policy) {
        return save(policy);
    }

    @Override
    default boolean policyNameAndVersionExists(String name, int version) {
        return existsByNameAndVersion(name, version);
    }

    @Override
    default int deactivateAllPolicies() {
        return deactivateAll();
    }

    @Override
    default java.util.Optional<Policy> findPolicyById(UUID id) {
        return findById(id);
    }

    @Override
    default java.util.Optional<Policy> findActivePolicy() {
        return findFirstByActiveTrueOrderByCreatedAtDescIdAsc();
    }
}
