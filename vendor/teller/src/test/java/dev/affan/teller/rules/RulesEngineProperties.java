package dev.affan.teller.rules;

import static org.assertj.core.api.Assertions.assertThat;

import dev.affan.teller.domain.Effect;
import dev.affan.teller.domain.RiskTier;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import net.jqwik.api.Arbitraries;
import net.jqwik.api.Arbitrary;
import net.jqwik.api.Combinators;
import net.jqwik.api.ForAll;
import net.jqwik.api.Provide;
import net.jqwik.api.Property;

class RulesEngineProperties {

    private static final int TRIES = 1_000;
    private final RulesEngine engine = new RulesEngine();

    @Property(tries = TRIES)
    void generatedPoliciesEqualAnIndependentReference(@ForAll("scenarios") Scenario scenario) {
        RuleEvaluation actual = engine.evaluate(scenario.rules(), scenario.call());

        RuleEvaluation expected = referenceEvaluate(scenario.rules(), scenario.call());

        assertThat(actual).isEqualTo(expected);
    }

    @Property(tries = TRIES)
    void defaultDenyWhenNothingMatches(@ForAll("calls") ProposedCall call) {
        RuleDefinition nonMatching = new RuleDefinition(
                UUID.fromString("00000000-0000-0000-0000-000000000001"),
                "unmatched.*",
                null,
                null,
                null,
                Effect.ALLOW,
                0);

        RuleEvaluation result = engine.evaluate(List.of(nonMatching), call);

        assertThat(result.effect()).isEqualTo(Effect.DENY);
        assertThat(result.matchedRuleId()).isEmpty();
    }

    @Property(tries = TRIES)
    void lowerPriorityRuleCannotChangeAnExistingMatch(
            @ForAll("policies") List<RuleDefinition> generated,
            @ForAll("calls") ProposedCall call,
            @ForAll Effect firstEffect) {
        RuleDefinition first = new RuleDefinition(
                UUID.fromString("00000000-0000-0000-0000-000000000002"),
                "*",
                null,
                null,
                null,
                firstEffect,
                0);
        List<RuleDefinition> original = new ArrayList<>();
        original.add(first);
        generated.stream().map(rule -> withPrecedence(rule, rule.precedence() + 1)).forEach(original::add);
        RuleEvaluation before = engine.evaluate(original, call);
        int lowerPriority = original.stream().mapToInt(RuleDefinition::precedence).max().orElse(0) + 1;
        RuleDefinition added = new RuleDefinition(
                UUID.fromString("00000000-0000-0000-0000-000000000003"),
                "*",
                null,
                null,
                null,
                firstEffect == Effect.DENY ? Effect.ALLOW : Effect.DENY,
                lowerPriority);

        List<RuleDefinition> extended = new ArrayList<>(original);
        extended.add(added);

        assertThat(engine.evaluate(extended, call)).isEqualTo(before);
    }

    @Property(tries = TRIES)
    void globMatcherEqualsItsRegexTranslation(
            @ForAll("globs") String glob,
            @ForAll("toolNames") String toolName) {
        RuleDefinition rule = new RuleDefinition(
                UUID.fromString("00000000-0000-0000-0000-000000000004"),
                glob,
                null,
                null,
                null,
                Effect.ALLOW,
                0);
        ProposedCall call = new ProposedCall("agent", toolName, "{}", RiskTier.LOW);

        boolean engineMatches = engine.evaluate(List.of(rule), call).matchedRuleId().isPresent();
        boolean regexMatches = Pattern.compile(globRegex(glob), Pattern.DOTALL)
                .matcher(toolName)
                .matches();

        assertThat(engineMatches).isEqualTo(regexMatches);
    }

    @Provide
    Arbitrary<Scenario> scenarios() {
        return Combinators.combine(policies(), calls()).as(Scenario::new);
    }

    @Provide
    Arbitrary<List<RuleDefinition>> policies() {
        return ruleSpecs().list().ofMinSize(0).ofMaxSize(8).map(specs -> {
            List<RuleDefinition> rules = new ArrayList<>(specs.size());
            for (int index = 0; index < specs.size(); index++) {
                RuleSpec spec = specs.get(index);
                UUID id = UUID.nameUUIDFromBytes(
                        (index + ":" + spec).getBytes(StandardCharsets.UTF_8));
                rules.add(new RuleDefinition(
                        id,
                        spec.glob(),
                        spec.argumentRegex(),
                        spec.agentId(),
                        spec.riskTier(),
                        spec.effect(),
                        spec.precedence()));
            }
            return rules;
        });
    }

    @Provide
    Arbitrary<ProposedCall> calls() {
        return Combinators.combine(
                        Arbitraries.of("agent-a", "agent-b", "batch-agent"),
                        toolNames(),
                        Arbitraries.of(
                                "{}",
                                "{\"path\":\"/safe/report\"}",
                                "{\"safe\":true}",
                                "{\"command\":\"drop\"}"),
                        Arbitraries.of(RiskTier.class))
                .as(ProposedCall::new);
    }

    @Provide
    Arbitrary<String> globs() {
        Arbitrary<String> edgeCases = Arbitraries.of(
                "*", "fs.*", "db.*.read", "shell.exec", "*write*", "a**b", ".*", "[$]*");
        Arbitrary<String> generated = Arbitraries.strings()
                .withChars("abcdfs.*-_$?[]")
                .ofMinLength(1)
                .ofMaxLength(12);
        return Arbitraries.oneOf(edgeCases, generated);
    }

    @Provide
    Arbitrary<String> toolNames() {
        Arbitrary<String> edgeCases = Arbitraries.of(
                "fs.read", "fs.write", "db.customer.read", "shell.exec", "browser.write", "a*b", "[$]");
        Arbitrary<String> generated = Arbitraries.strings()
                .withChars("abcdfs.*-_$?[]")
                .ofMinLength(1)
                .ofMaxLength(14);
        return Arbitraries.oneOf(edgeCases, generated);
    }

    private Arbitrary<RuleSpec> ruleSpecs() {
        Arbitrary<String> regex = Arbitraries.of(
                null,
                "path",
                "\\\"safe\\\":true",
                "^\\{.*\\}$",
                "drop|deny");
        Arbitrary<String> agent = Arbitraries.of(null, "agent-a", "agent-b", "batch-agent");
        Arbitrary<RiskTier> risk = Arbitraries.of(
                null, RiskTier.LOW, RiskTier.MEDIUM, RiskTier.HIGH, RiskTier.CRITICAL);
        return Combinators.combine(
                        globs(),
                        regex,
                        agent,
                        risk,
                        Arbitraries.of(Effect.class),
                        Arbitraries.integers().between(0, 50))
                .as(RuleSpec::new);
    }

    private static RuleEvaluation referenceEvaluate(List<RuleDefinition> rules, ProposedCall call) {
        List<RuleDefinition> ordered = new ArrayList<>(rules);
        ordered.sort(Comparator.comparingInt(RuleDefinition::precedence));
        for (RuleDefinition rule : ordered) {
            if (referenceMatches(rule, call)) {
                return new RuleEvaluation(rule.effect(), Optional.of(rule.id()));
            }
        }
        return new RuleEvaluation(Effect.DENY, Optional.empty());
    }

    private static boolean referenceMatches(RuleDefinition rule, ProposedCall call) {
        return wildcardMatches(rule.toolNameGlob(), call.toolName())
                && (rule.argumentRegex() == null
                        || Pattern.compile(rule.argumentRegex(), Pattern.DOTALL)
                                .matcher(call.argumentsJson())
                                .find())
                && (rule.agentId() == null || rule.agentId().equals(call.agentId()))
                && (rule.riskTier() == null || rule.riskTier() == call.riskTier());
    }

    private static boolean wildcardMatches(String glob, String value) {
        int globIndex = 0;
        int valueIndex = 0;
        int starIndex = -1;
        int retryValueIndex = -1;
        while (valueIndex < value.length()) {
            if (globIndex < glob.length()
                    && glob.charAt(globIndex) != '*'
                    && glob.charAt(globIndex) == value.charAt(valueIndex)) {
                globIndex++;
                valueIndex++;
            } else if (globIndex < glob.length() && glob.charAt(globIndex) == '*') {
                starIndex = globIndex++;
                retryValueIndex = valueIndex;
            } else if (starIndex >= 0) {
                globIndex = starIndex + 1;
                valueIndex = ++retryValueIndex;
            } else {
                return false;
            }
        }
        while (globIndex < glob.length() && glob.charAt(globIndex) == '*') {
            globIndex++;
        }
        return globIndex == glob.length();
    }

    private static String globRegex(String glob) {
        return "^" + List.of(glob.split("\\*", -1)).stream()
                .map(Pattern::quote)
                .collect(Collectors.joining(".*")) + "$";
    }

    private static RuleDefinition withPrecedence(RuleDefinition rule, int precedence) {
        return new RuleDefinition(
                rule.id(),
                rule.toolNameGlob(),
                rule.argumentRegex(),
                rule.agentId(),
                rule.riskTier(),
                rule.effect(),
                precedence);
    }

    private record Scenario(List<RuleDefinition> rules, ProposedCall call) {
    }

    private record RuleSpec(
            String glob,
            String argumentRegex,
            String agentId,
            RiskTier riskTier,
            Effect effect,
            int precedence) {
    }
}
