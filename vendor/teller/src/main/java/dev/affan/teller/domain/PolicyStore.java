package dev.affan.teller.domain;

import java.util.Optional;
import java.util.UUID;

public interface PolicyStore {

    Policy storePolicy(Policy policy);

    boolean policyNameAndVersionExists(String name, int version);

    int deactivateAllPolicies();

    Optional<Policy> findPolicyById(UUID id);

    Optional<Policy> findActivePolicy();
}
