package dev.affan.teller.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import dev.affan.teller.TestcontainersConfiguration;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.testcontainers.junit.jupiter.Testcontainers;

@Testcontainers(disabledWithoutDocker = true)
@Import(TestcontainersConfiguration.class)
@SpringBootTest(properties = {
        "teller.api-key=integration-key",
        "teller.aws.enabled=false"
})
class PersistenceIntegrationTest {

    @Autowired private PolicyService policyService;
    @Autowired private DecisionService decisionService;
    @Autowired private RuleRepository ruleRepository;
    @Autowired private JdbcTemplate jdbcTemplate;

    @Test
    void loadsRulesInPrecedenceOrder() {
        Policy policy = policyService.createPolicy(new CreatePolicyCommand(uniqueName("ordered"), 1));
        policyService.addRule(policy.getId(), rule(20, Effect.ALLOW));
        policyService.addRule(policy.getId(), rule(10, Effect.DENY));

        List<Rule> rules = ruleRepository.findByPolicyIdOrderByPrecedenceAscIdAsc(policy.getId());

        assertThat(rules).extracting(Rule::getPrecedence).containsExactly(10, 20);
    }

    @Test
    void databaseRejectsDecisionMutation() {
        Policy policy = policyService.createPolicy(new CreatePolicyCommand(uniqueName("decision"), 1));
        Decision decision = decisionService.evaluate(new EvaluateDecisionCommand(
                        policy.getId(), "agent-1", "fs.read", "{}", RiskTier.LOW))
                .decision();

        assertThatThrownBy(() -> jdbcTemplate.update(
                        "update decisions set tool_name = ? where id = ?",
                        "changed",
                        decision.getId()))
                .isInstanceOf(DataAccessException.class)
                .hasMessageContaining("immutable");
    }

    @Test
    void databaseRejectsAuditRecordDeletion() {
        Policy policy = policyService.createPolicy(new CreatePolicyCommand(uniqueName("audit"), 1));

        assertThatThrownBy(() -> jdbcTemplate.update(
                        "delete from audit_records where aggregate_id = ?",
                        policy.getId()))
                .isInstanceOf(DataAccessException.class)
                .hasMessageContaining("immutable");
    }

    private static CreateRuleCommand rule(int precedence, Effect effect) {
        return new CreateRuleCommand("*", null, null, null, effect, precedence);
    }

    private static String uniqueName(String prefix) {
        return prefix + "-" + UUID.randomUUID();
    }
}
