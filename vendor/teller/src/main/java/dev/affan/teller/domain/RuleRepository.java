package dev.affan.teller.domain;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface RuleRepository extends JpaRepository<Rule, UUID>, RuleStore {
    List<Rule> findByPolicyIdOrderByPrecedenceAscIdAsc(UUID policyId);

    @Override
    default Rule storeRule(Rule rule) {
        return save(rule);
    }

    @Override
    default List<Rule> findRulesByPolicyId(UUID policyId) {
        return findByPolicyIdOrderByPrecedenceAscIdAsc(policyId);
    }
}
