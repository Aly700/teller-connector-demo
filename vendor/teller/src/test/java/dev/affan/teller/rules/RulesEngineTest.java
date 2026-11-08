package dev.affan.teller.rules;

import static org.assertj.core.api.Assertions.assertThat;

import dev.affan.teller.domain.Effect;
import dev.affan.teller.domain.RiskTier;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class RulesEngineTest {

    private final RulesEngine rulesEngine = new RulesEngine();

    @Test
    void evaluatesRulesInAscendingPrecedenceOrder() {
        RuleDefinition laterAllow = rule(20, "*", null, null, null, Effect.ALLOW);
        RuleDefinition earlierDeny = rule(10, "*", null, null, null, Effect.DENY);

        RuleEvaluation result = rulesEngine.evaluate(
                List.of(laterAllow, earlierDeny),
                call("agent-1", "fs.read", "{}", RiskTier.LOW));

        assertThat(result.effect()).isEqualTo(Effect.DENY);
        assertThat(result.matchedRuleId()).contains(earlierDeny.id());
    }

    @Test
    void stopsAtTheFirstMatchingRule() {
        RuleDefinition first = rule(1, "fs.*", null, null, null, Effect.REQUIRE_APPROVAL);
        RuleDefinition second = rule(2, "fs.*", null, null, null, Effect.ALLOW);

        RuleEvaluation result = rulesEngine.evaluate(
                List.of(first, second),
                call("agent-1", "fs.write", "{}", RiskTier.MEDIUM));

        assertThat(result.effect()).isEqualTo(Effect.REQUIRE_APPROVAL);
        assertThat(result.matchedRuleId()).contains(first.id());
    }

    @Test
    void deniesWhenNoRuleMatches() {
        RuleEvaluation result = rulesEngine.evaluate(
                List.of(rule(1, "db.*", null, null, null, Effect.ALLOW)),
                call("agent-1", "fs.read", "{}", RiskTier.LOW));

        assertThat(result.effect()).isEqualTo(Effect.DENY);
        assertThat(result.matchedRuleId()).isEmpty();
    }

    @Test
    void matchesToolNamePrefixGlob() {
        RuleDefinition matching = rule(1, "fs.*", null, null, null, Effect.ALLOW);

        RuleEvaluation result = rulesEngine.evaluate(
                List.of(matching),
                call("agent-1", "fs.read", "{}", RiskTier.LOW));

        assertThat(result.matchedRuleId()).contains(matching.id());
    }

    @Test
    void starGlobMatchesEveryToolName() {
        RuleDefinition matching = rule(1, "*", null, null, null, Effect.ALLOW);

        RuleEvaluation result = rulesEngine.evaluate(
                List.of(matching),
                call("agent-1", "browser.navigate", "{}", RiskTier.LOW));

        assertThat(result.matchedRuleId()).contains(matching.id());
    }

    @Test
    void argumentRegexSearchesTheArgumentsJson() {
        RuleDefinition matching = rule(
                1,
                "email.send",
                "\\\"recipient\\\"\\s*:\\s*\\\"[^\\\"]+@example\\.test\\\"",
                null,
                null,
                Effect.REQUIRE_APPROVAL);

        RuleEvaluation result = rulesEngine.evaluate(
                List.of(matching),
                call("agent-1", "email.send", "{\"recipient\":\"reviewer@example.test\"}", RiskTier.HIGH));

        assertThat(result.matchedRuleId()).contains(matching.id());
    }

    @Test
    void agentMatcherRequiresAnExactAgentId() {
        RuleDefinition restricted = rule(1, "*", null, "agent-2", null, Effect.ALLOW);

        RuleEvaluation result = rulesEngine.evaluate(
                List.of(restricted),
                call("agent-1", "fs.read", "{}", RiskTier.LOW));

        assertThat(result.effect()).isEqualTo(Effect.DENY);
        assertThat(result.matchedRuleId()).isEmpty();
    }

    @Test
    void riskTierMatcherRequiresTheProposedTier() {
        RuleDefinition highRiskOnly = rule(1, "*", null, null, RiskTier.HIGH, Effect.DENY);
        RuleDefinition fallback = rule(2, "*", null, null, null, Effect.ALLOW);

        RuleEvaluation result = rulesEngine.evaluate(
                List.of(highRiskOnly, fallback),
                call("agent-1", "fs.read", "{}", RiskTier.LOW));

        assertThat(result.effect()).isEqualTo(Effect.ALLOW);
        assertThat(result.matchedRuleId()).contains(fallback.id());
    }

    private static ProposedCall call(String agentId, String toolName, String argumentsJson, RiskTier riskTier) {
        return new ProposedCall(agentId, toolName, argumentsJson, riskTier);
    }

    private static RuleDefinition rule(
            int precedence,
            String toolNameGlob,
            String argumentRegex,
            String agentId,
            RiskTier riskTier,
            Effect effect) {
        return new RuleDefinition(
                UUID.randomUUID(),
                toolNameGlob,
                argumentRegex,
                agentId,
                riskTier,
                effect,
                precedence);
    }
}
