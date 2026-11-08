package dev.affan.teller.rules;

import static org.assertj.core.api.Assertions.assertThat;

import dev.affan.teller.domain.Effect;
import dev.affan.teller.domain.Policy;
import dev.affan.teller.domain.PolicyStore;
import dev.affan.teller.domain.Rule;
import dev.affan.teller.domain.RuleStore;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

class PolicyCacheTest {

    private static final Instant NOW = Instant.parse("2026-08-29T12:00:00Z");
    private static final UUID POLICY_ID = UUID.fromString("00000000-0000-0000-0000-000000000101");

    @Test
    void repeatedLookupHitsTheCache() {
        CountingPolicyStore policies = new CountingPolicyStore();
        CountingRuleStore rules = new CountingRuleStore(rule(10, Effect.ALLOW));
        PolicyCache cache = new PolicyCache(policies, rules);

        PolicyCache.PolicyRules first = cache.get(POLICY_ID);
        PolicyCache.PolicyRules second = cache.get(POLICY_ID);

        assertThat(second).isSameAs(first);
        assertThat(policies.loads).hasValue(1);
        assertThat(rules.loads).hasValue(1);
    }

    @Test
    void lookupWithAnAlreadyLoadedPolicyDoesNotReadThePolicyAgain() {
        CountingPolicyStore policies = new CountingPolicyStore();
        CountingRuleStore rules = new CountingRuleStore(rule(10, Effect.ALLOW));
        PolicyCache cache = new PolicyCache(policies, rules);

        PolicyCache.PolicyRules first = cache.get(policies.policy);
        PolicyCache.PolicyRules second = cache.get(POLICY_ID);

        assertThat(second).isSameAs(first);
        assertThat(policies.loads).hasValue(0);
        assertThat(rules.loads).hasValue(1);
    }

    @Test
    void invalidationAfterRuleAdditionReloadsTheRuleSet() {
        CountingPolicyStore policies = new CountingPolicyStore();
        CountingRuleStore rules = new CountingRuleStore(rule(10, Effect.ALLOW));
        PolicyCache cache = new PolicyCache(policies, rules);
        PolicyCache.PolicyRules before = cache.get(POLICY_ID);

        rules.rows.add(rule(5, Effect.DENY));
        cache.invalidate(POLICY_ID);
        PolicyCache.PolicyRules after = cache.get(POLICY_ID);

        assertThat(after).isNotSameAs(before);
        assertThat(after.rules()).extracting(Rule::getEffect).containsExactly(Effect.DENY, Effect.ALLOW);
        assertThat(policies.loads).hasValue(2);
        assertThat(rules.loads).hasValue(2);
    }

    private static Rule rule(int precedence, Effect effect) {
        return Rule.create(
                UUID.randomUUID(),
                POLICY_ID,
                "*",
                null,
                null,
                null,
                effect,
                precedence,
                NOW);
    }

    private static final class CountingPolicyStore implements PolicyStore {

        private final Policy policy = Policy.create(POLICY_ID, "cached", 1, NOW);
        private final AtomicInteger loads = new AtomicInteger();

        @Override
        public Policy storePolicy(Policy policy) {
            throw new UnsupportedOperationException();
        }

        @Override
        public boolean policyNameAndVersionExists(String name, int version) {
            throw new UnsupportedOperationException();
        }

        @Override
        public int deactivateAllPolicies() {
            throw new UnsupportedOperationException();
        }

        @Override
        public Optional<Policy> findPolicyById(UUID id) {
            loads.incrementAndGet();
            return id.equals(POLICY_ID) ? Optional.of(policy) : Optional.empty();
        }

        @Override
        public Optional<Policy> findActivePolicy() {
            throw new UnsupportedOperationException();
        }
    }

    private static final class CountingRuleStore implements RuleStore {

        private final List<Rule> rows = new ArrayList<>();
        private final AtomicInteger loads = new AtomicInteger();

        private CountingRuleStore(Rule... rules) {
            rows.addAll(List.of(rules));
        }

        @Override
        public Rule storeRule(Rule rule) {
            rows.add(rule);
            return rule;
        }

        @Override
        public List<Rule> findRulesByPolicyId(UUID policyId) {
            loads.incrementAndGet();
            return rows.stream()
                    .filter(rule -> rule.getPolicyId().equals(policyId))
                    .sorted(Comparator.comparingInt(Rule::getPrecedence))
                    .toList();
        }
    }
}
