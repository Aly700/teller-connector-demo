package dev.affan.teller.domain;

import java.util.List;
import java.util.UUID;

public interface RuleStore {

    Rule storeRule(Rule rule);

    List<Rule> findRulesByPolicyId(UUID policyId);
}
