package dev.affan.teller.rules;

import dev.affan.teller.domain.Effect;
import java.util.Comparator;
import java.util.List;
import java.util.Objects;
import java.util.regex.Pattern;

public final class RulesEngine {

    public RuleEvaluation evaluate(List<RuleDefinition> rules, ProposedCall call) {
        Objects.requireNonNull(rules, "rules");
        Objects.requireNonNull(call, "call");

        return rules.stream()
                .sorted(Comparator.comparingInt(RuleDefinition::precedence))
                .filter(rule -> matches(rule, call))
                .findFirst()
                .map(rule -> RuleEvaluation.matched(rule, effectiveEffect(rule, call)))
                .orElseGet(RuleEvaluation::defaultDeny);
    }

    private boolean matches(RuleDefinition rule, ProposedCall call) {
        return toolMatches(rule.toolNameGlob(), call.toolName())
                && optionalRegexMatches(rule.argumentRegex(), call.argumentsJson())
                && optionalValueMatches(rule.agentId(), call.agentId())
                && optionalValueMatches(rule.riskTier(), call.riskTier())
                && optionalMinimumMatches(rule.amountMinMinor(), call.amountMinor())
                && optionalMaximumMatches(rule.amountMaxMinor(), call.amountMinor())
                && optionalValueMatches(rule.currency(), call.currency())
                && optionalVelocityMatches(rule, call)
                && counterpartyMatches(rule, call.counterpartyAccountId())
                && optionalExclusiveMinimumMatches(rule.fourEyesAboveMinor(), call.amountMinor());
    }

    private Effect effectiveEffect(RuleDefinition rule, ProposedCall call) {
        return call.counterpartyAccountId() != null
                        && rule.counterpartyDeny().contains(call.counterpartyAccountId())
                ? Effect.DENY
                : rule.effect();
    }

    private boolean optionalMinimumMatches(Long minimum, Long value) {
        return minimum == null || value != null && value >= minimum;
    }

    private boolean optionalExclusiveMinimumMatches(Long minimum, Long value) {
        return minimum == null || value != null && value > minimum;
    }

    private boolean optionalMaximumMatches(Long maximum, Long value) {
        return maximum == null || value != null && value <= maximum;
    }

    private boolean optionalVelocityMatches(RuleDefinition rule, ProposedCall call) {
        if (rule.velocityMax() == null) {
            return true;
        }
        Long count = call.velocityCounts().get(rule.velocityWindowSeconds());
        return count != null && count < rule.velocityMax();
    }

    private boolean counterpartyMatches(RuleDefinition rule, java.util.UUID counterparty) {
        if (rule.counterpartyAllow().isEmpty() && rule.counterpartyDeny().isEmpty()) {
            return true;
        }
        if (counterparty == null) {
            return false;
        }
        if (rule.counterpartyDeny().contains(counterparty)) {
            return true;
        }
        return !rule.counterpartyAllow().isEmpty() && rule.counterpartyAllow().contains(counterparty);
    }

    private boolean toolMatches(String glob, String toolName) {
        String[] literalSegments = glob.split("\\*", -1);
        StringBuilder regex = new StringBuilder("^");
        for (int index = 0; index < literalSegments.length; index++) {
            if (index > 0) {
                regex.append(".*");
            }
            regex.append(Pattern.quote(literalSegments[index]));
        }
        regex.append('$');
        return Pattern.compile(regex.toString(), Pattern.DOTALL).matcher(toolName).matches();
    }

    private boolean optionalRegexMatches(String regex, String value) {
        return regex == null || Pattern.compile(regex, Pattern.DOTALL).matcher(value).find();
    }

    private boolean optionalValueMatches(Object matcher, Object value) {
        return matcher == null || matcher.equals(value);
    }
}
