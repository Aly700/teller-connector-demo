package dev.affan.teller.rules;

import static org.assertj.core.api.Assertions.assertThat;

import dev.affan.teller.domain.Effect;
import dev.affan.teller.domain.RiskTier;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import net.jqwik.api.ForAll;
import net.jqwik.api.Property;
import net.jqwik.api.constraints.IntRange;
import net.jqwik.api.constraints.LongRange;

class MoneyRulesEngineProperties {

    private final RulesEngine engine = new RulesEngine();

    @Property(tries = 1_000)
    void amountBoundsAreInclusive(
            @ForAll @LongRange(min = 0, max = 1_000_000) long minimum,
            @ForAll @LongRange(min = 0, max = 1_000_000) long width,
            @ForAll @LongRange(min = 0, max = 2_000_001) long amount) {
        long maximum = minimum + width;
        RuleDefinition rule = moneyRule(minimum, maximum, null, null, null, Set.of(), Set.of());

        RuleEvaluation result = engine.evaluate(List.of(rule), transferCall(amount, Map.of(), UUID.randomUUID()));

        assertThat(result.matchedRuleId().isPresent())
                .isEqualTo(amount >= minimum && amount <= maximum);
    }

    @Property(tries = 1_000)
    void velocityCountsOnlyPermitTheFirstNTransfers(
            @ForAll @IntRange(min = 1, max = 100) int maximum,
            @ForAll @IntRange(min = 0, max = 150) int previousCount) {
        long windowSeconds = 3_600;
        RuleDefinition rule = moneyRule(
                null, null, maximum, windowSeconds, null, Set.of(), Set.of());

        RuleEvaluation result = engine.evaluate(
                List.of(rule),
                transferCall(100, Map.of(windowSeconds, (long) previousCount), UUID.randomUUID()));

        assertThat(result.matchedRuleId().isPresent()).isEqualTo(previousCount < maximum);
    }

    @Property(tries = 250)
    void counterpartyDenyListWinsWhenTheSameAccountIsAlsoAllowed(@ForAll long counterpartyBits) {
        UUID counterparty = new UUID(0, counterpartyBits);
        RuleDefinition rule = moneyRule(
                null, null, null, null, null, Set.of(counterparty), Set.of(counterparty));

        RuleEvaluation result = engine.evaluate(
                List.of(rule), transferCall(100, Map.of(), counterparty));

        assertThat(result.effect()).isEqualTo(Effect.DENY);
        assertThat(result.matchedRuleId()).contains(rule.id());
    }

    @Property(tries = 1_000)
    void fourEyesThresholdMatchesOnlyAmountsStrictlyAboveIt(
            @ForAll @LongRange(min = 0, max = 1_000_000) long threshold,
            @ForAll @LongRange(min = 0, max = 1_000_001) long amount) {
        RuleDefinition rule = moneyRule(
                null, null, null, null, threshold, Set.of(), Set.of(), Effect.REQUIRE_APPROVAL);

        RuleEvaluation result = engine.evaluate(List.of(rule), transferCall(amount, Map.of(), UUID.randomUUID()));

        assertThat(result.matchedRuleId().isPresent()).isEqualTo(amount > threshold);
    }

    private static RuleDefinition moneyRule(
            Long minimum,
            Long maximum,
            Integer velocityMax,
            Long velocityWindowSeconds,
            Long fourEyesAbove,
            Set<UUID> allow,
            Set<UUID> deny) {
        return moneyRule(
                minimum,
                maximum,
                velocityMax,
                velocityWindowSeconds,
                fourEyesAbove,
                allow,
                deny,
                Effect.ALLOW);
    }

    private static RuleDefinition moneyRule(
            Long minimum,
            Long maximum,
            Integer velocityMax,
            Long velocityWindowSeconds,
            Long fourEyesAbove,
            Set<UUID> allow,
            Set<UUID> deny,
            Effect effect) {
        return new RuleDefinition(
                UUID.randomUUID(),
                "ledger.transfer",
                null,
                null,
                RiskTier.MEDIUM,
                effect,
                10,
                minimum,
                maximum,
                "USD",
                velocityMax,
                velocityWindowSeconds,
                allow,
                deny,
                fourEyesAbove);
    }

    private static ProposedCall transferCall(long amount, Map<Long, Long> velocity, UUID counterparty) {
        return new ProposedCall(
                "initiator",
                "ledger.transfer",
                "{}",
                RiskTier.MEDIUM,
                amount,
                "USD",
                UUID.randomUUID(),
                counterparty,
                velocity);
    }
}
