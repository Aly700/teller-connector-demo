package dev.affan.teller.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.PostLoad;
import jakarta.persistence.PostPersist;
import jakarta.persistence.Table;
import jakarta.persistence.Transient;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;
import org.hibernate.annotations.Immutable;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import org.springframework.data.domain.Persistable;

@Entity
@Immutable
@Table(name = "decisions")
public class Decision implements Persistable<UUID> {

    @Id
    private UUID id;

    @Column(name = "policy_id", nullable = false, updatable = false)
    private UUID policyId;

    @Column(name = "policy_version", nullable = false, updatable = false)
    private int policyVersion;

    @Column(name = "agent_id", nullable = false, updatable = false)
    private String agentId;

    @Column(name = "tool_name", nullable = false, updatable = false)
    private String toolName;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false, updatable = false, columnDefinition = "jsonb")
    private String arguments;

    @Enumerated(EnumType.STRING)
    @Column(name = "risk_tier", nullable = false, updatable = false)
    private RiskTier riskTier;

    @Column(name = "matched_rule_id", updatable = false)
    private UUID matchedRuleId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, updatable = false)
    private Effect effect;

    @Column(name = "decided_at", nullable = false, updatable = false)
    private Instant decidedAt;

    @Transient
    private boolean newEntity = true;

    protected Decision() {
    }

    private Decision(
            UUID id,
            UUID policyId,
            int policyVersion,
            String agentId,
            String toolName,
            String arguments,
            RiskTier riskTier,
            UUID matchedRuleId,
            Effect effect,
            Instant decidedAt) {
        this.id = Objects.requireNonNull(id, "id");
        this.policyId = Objects.requireNonNull(policyId, "policyId");
        this.policyVersion = policyVersion;
        this.agentId = Objects.requireNonNull(agentId, "agentId");
        this.toolName = Objects.requireNonNull(toolName, "toolName");
        this.arguments = Objects.requireNonNull(arguments, "arguments");
        this.riskTier = Objects.requireNonNull(riskTier, "riskTier");
        this.matchedRuleId = matchedRuleId;
        this.effect = Objects.requireNonNull(effect, "effect");
        this.decidedAt = Objects.requireNonNull(decidedAt, "decidedAt");
    }

    public static Decision create(
            UUID id,
            UUID policyId,
            int policyVersion,
            String agentId,
            String toolName,
            String arguments,
            RiskTier riskTier,
            UUID matchedRuleId,
            Effect effect,
            Instant decidedAt) {
        return new Decision(
                id,
                policyId,
                policyVersion,
                agentId,
                toolName,
                arguments,
                riskTier,
                matchedRuleId,
                effect,
                decidedAt);
    }

    @Override
    public UUID getId() { return id; }

    @Override
    public boolean isNew() { return newEntity; }

    @PostLoad
    @PostPersist
    void markNotNew() { newEntity = false; }

    public UUID getPolicyId() { return policyId; }
    public int getPolicyVersion() { return policyVersion; }
    public String getAgentId() { return agentId; }
    public String getToolName() { return toolName; }
    public String getArguments() { return arguments; }
    public RiskTier getRiskTier() { return riskTier; }
    public UUID getMatchedRuleId() { return matchedRuleId; }
    public Effect getEffect() { return effect; }
    public Instant getDecidedAt() { return decidedAt; }
}
