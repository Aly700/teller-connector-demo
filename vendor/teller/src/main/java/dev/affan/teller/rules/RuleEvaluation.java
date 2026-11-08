package dev.affan.teller.rules;

import dev.affan.teller.domain.Effect;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

public record RuleEvaluation(Effect effect, Optional<UUID> matchedRuleId) {

    public RuleEvaluation {
        Objects.requireNonNull(effect, "effect");
        Objects.requireNonNull(matchedRuleId, "matchedRuleId");
    }

    static RuleEvaluation matched(RuleDefinition rule) {
        return new RuleEvaluation(rule.effect(), Optional.of(rule.id()));
    }

    static RuleEvaluation matched(RuleDefinition rule, Effect effect) {
        return new RuleEvaluation(effect, Optional.of(rule.id()));
    }

    static RuleEvaluation defaultDeny() {
        return new RuleEvaluation(Effect.DENY, Optional.empty());
    }
}
