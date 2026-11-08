package dev.affan.teller.domain;

import dev.affan.teller.rules.RuleDefinition;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "rules")
public class Rule {

    @Id
    private UUID id;

    @Column(name = "policy_id", nullable = false, updatable = false)
    private UUID policyId;

    @Column(name = "tool_name_glob", nullable = false, updatable = false)
    private String toolNameGlob;

    @Column(name = "argument_regex", updatable = false)
    private String argumentRegex;

    @Column(name = "agent_id", updatable = false)
    private String agentId;

    @Enumerated(EnumType.STRING)
    @Column(name = "risk_tier", updatable = false)
    private RiskTier riskTier;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, updatable = false)
    private Effect effect;

    @Column(nullable = false, updatable = false)
    private int precedence;

    @Column(name = "amount_min_minor", updatable = false)
    private Long amountMinMinor;

    @Column(name = "amount_max_minor", updatable = false)
    private Long amountMaxMinor;

    @Column(length = 3, updatable = false)
    private String currency;

    @Column(name = "velocity_max", updatable = false)
    private Integer velocityMax;

    @Column(name = "velocity_window_seconds", updatable = false)
    private Long velocityWindowSeconds;

    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(name = "counterparty_allow", columnDefinition = "uuid[]", updatable = false)
    private UUID[] counterpartyAllow;

    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(name = "counterparty_deny", columnDefinition = "uuid[]", updatable = false)
    private UUID[] counterpartyDeny;

    @Column(name = "four_eyes_above_minor", updatable = false)
    private Long fourEyesAboveMinor;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected Rule() {
    }

    private Rule(UUID policyId, RuleDefinition definition, Instant createdAt) {
        this.id = definition.id();
        this.policyId = Objects.requireNonNull(policyId, "policyId");
        this.toolNameGlob = definition.toolNameGlob();
        this.argumentRegex = definition.argumentRegex();
        this.agentId = definition.agentId();
        this.riskTier = definition.riskTier();
        this.effect = definition.effect();
        this.precedence = definition.precedence();
        this.amountMinMinor = definition.amountMinMinor();
        this.amountMaxMinor = definition.amountMaxMinor();
        this.currency = definition.currency();
        this.velocityMax = definition.velocityMax();
        this.velocityWindowSeconds = definition.velocityWindowSeconds();
        this.counterpartyAllow = definition.counterpartyAllow().toArray(UUID[]::new);
        this.counterpartyDeny = definition.counterpartyDeny().toArray(UUID[]::new);
        this.fourEyesAboveMinor = definition.fourEyesAboveMinor();
        this.createdAt = Objects.requireNonNull(createdAt, "createdAt");
    }

    public static Rule create(
            UUID id,
            UUID policyId,
            String toolNameGlob,
            String argumentRegex,
            String agentId,
            RiskTier riskTier,
            Effect effect,
            int precedence,
            Instant createdAt) {
        return create(
                id,
                policyId,
                toolNameGlob,
                argumentRegex,
                agentId,
                riskTier,
                effect,
                precedence,
                null,
                null,
                null,
                null,
                null,
                Set.of(),
                Set.of(),
                null,
                createdAt);
    }

    public static Rule create(
            UUID id,
            UUID policyId,
            String toolNameGlob,
            String argumentRegex,
            String agentId,
            RiskTier riskTier,
            Effect effect,
            int precedence,
            Long amountMinMinor,
            Long amountMaxMinor,
            String currency,
            Integer velocityMax,
            Long velocityWindowSeconds,
            Set<UUID> counterpartyAllow,
            Set<UUID> counterpartyDeny,
            Long fourEyesAboveMinor,
            Instant createdAt) {
        RuleDefinition definition = new RuleDefinition(
                id,
                toolNameGlob,
                argumentRegex,
                agentId,
                riskTier,
                effect,
                precedence,
                amountMinMinor,
                amountMaxMinor,
                currency,
                velocityMax,
                velocityWindowSeconds,
                counterpartyAllow,
                counterpartyDeny,
                fourEyesAboveMinor);
        return new Rule(policyId, definition, createdAt);
    }

    public RuleDefinition toDefinition() {
        return new RuleDefinition(
                id,
                toolNameGlob,
                argumentRegex,
                agentId,
                riskTier,
                effect,
                precedence,
                amountMinMinor,
                amountMaxMinor,
                currency,
                velocityMax,
                velocityWindowSeconds,
                Set.of(counterpartyAllow),
                Set.of(counterpartyDeny),
                fourEyesAboveMinor);
    }

    public UUID getId() { return id; }
    public UUID getPolicyId() { return policyId; }
    public String getToolNameGlob() { return toolNameGlob; }
    public String getArgumentRegex() { return argumentRegex; }
    public String getAgentId() { return agentId; }
    public RiskTier getRiskTier() { return riskTier; }
    public Effect getEffect() { return effect; }
    public int getPrecedence() { return precedence; }
    public Long getAmountMinMinor() { return amountMinMinor; }
    public Long getAmountMaxMinor() { return amountMaxMinor; }
    public String getCurrency() { return currency; }
    public Integer getVelocityMax() { return velocityMax; }
    public Long getVelocityWindowSeconds() { return velocityWindowSeconds; }
    public Set<UUID> getCounterpartyAllow() { return Set.of(counterpartyAllow); }
    public Set<UUID> getCounterpartyDeny() { return Set.of(counterpartyDeny); }
    public Long getFourEyesAboveMinor() { return fourEyesAboveMinor; }
    public Instant getCreatedAt() { return createdAt; }
}
