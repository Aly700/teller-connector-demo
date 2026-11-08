package dev.affan.teller.rules;

import dev.affan.teller.domain.Policy;
import dev.affan.teller.domain.PolicyStore;
import dev.affan.teller.domain.ResourceNotFoundException;
import dev.affan.teller.domain.Rule;
import dev.affan.teller.domain.RuleStore;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import org.springframework.stereotype.Component;

@Component
public final class PolicyCache {

    private final PolicyStore policies;
    private final RuleStore rules;
    private final ConcurrentMap<CacheKey, PolicyRules> entries = new ConcurrentHashMap<>();
    private final ConcurrentMap<UUID, Long> ruleSetVersions = new ConcurrentHashMap<>();

    public PolicyCache(PolicyStore policies, RuleStore rules) {
        this.policies = policies;
        this.rules = rules;
    }

    public PolicyRules get(UUID policyId) {
        Objects.requireNonNull(policyId, "policyId");
        CacheKey key = key(policyId);
        return entries.computeIfAbsent(key, ignored -> load(policyId));
    }

    public PolicyRules get(Policy policy) {
        Objects.requireNonNull(policy, "policy");
        CacheKey key = key(policy.getId());
        return entries.computeIfAbsent(
                key,
                ignored -> new PolicyRules(policy, rules.findRulesByPolicyId(policy.getId())));
    }

    public void invalidate(UUID policyId) {
        Objects.requireNonNull(policyId, "policyId");
        ruleSetVersions.merge(policyId, 1L, Long::sum);
        entries.keySet().removeIf(key -> key.policyId().equals(policyId));
    }

    private CacheKey key(UUID policyId) {
        return new CacheKey(policyId, ruleSetVersions.getOrDefault(policyId, 0L));
    }

    private PolicyRules load(UUID policyId) {
        Policy policy = policies.findPolicyById(policyId)
                .orElseThrow(() -> new ResourceNotFoundException("policy", policyId));
        return new PolicyRules(policy, rules.findRulesByPolicyId(policyId));
    }

    private record CacheKey(UUID policyId, long ruleSetVersion) {
    }

    public record PolicyRules(Policy policy, List<Rule> rules) {

        public PolicyRules {
            Objects.requireNonNull(policy, "policy");
            rules = List.copyOf(rules);
        }
    }
}
