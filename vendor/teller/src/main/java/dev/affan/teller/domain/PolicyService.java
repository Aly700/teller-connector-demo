package dev.affan.teller.domain;

import dev.affan.teller.rules.PolicyCache;
import java.time.Clock;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

@Service
public class PolicyService {

    private final PolicyStore policies;
    private final RuleStore rules;
    private final AuditService auditService;
    private final PolicyCache policyCache;
    private final Clock clock;

    public PolicyService(
            PolicyStore policies,
            RuleStore rules,
            AuditService auditService,
            PolicyCache policyCache,
            Clock clock) {
        this.policies = policies;
        this.rules = rules;
        this.auditService = auditService;
        this.policyCache = policyCache;
        this.clock = clock;
    }

    @Transactional
    public Policy createPolicy(CreatePolicyCommand command) {
        String name = command.name().trim();
        if (policies.policyNameAndVersionExists(name, command.version())) {
            throw new ConflictException("policy name and version already exist");
        }
        policies.deactivateAllPolicies();
        Policy policy = policies.storePolicy(Policy.create(
                UUID.randomUUID(), name, command.version(), clock.instant()));
        auditService.append(
                AuditEventType.POLICY_CREATED,
                "POLICY",
                policy.getId(),
                Map.of("name", policy.getName(), "version", policy.getVersion()));
        return policy;
    }

    @Transactional
    public Rule addRule(UUID policyId, CreateRuleCommand command) {
        policies.findPolicyById(policyId)
                .orElseThrow(() -> new ResourceNotFoundException("policy", policyId));
        validateRegex(command.argumentRegex());
        Rule rule = rules.storeRule(Rule.create(
                UUID.randomUUID(),
                policyId,
                command.toolNameGlob(),
                emptyToNull(command.argumentRegex()),
                emptyToNull(command.agentId()),
                command.riskTier(),
                command.effect(),
                command.precedence(),
                command.amountMinMinor(),
                command.amountMaxMinor(),
                emptyToNull(command.currency()),
                command.velocityMax(),
                command.velocityWindowSeconds(),
                command.counterpartyAllow(),
                command.counterpartyDeny(),
                command.fourEyesAboveMinor(),
                clock.instant()));
        auditService.append(
                AuditEventType.RULE_CREATED,
                "RULE",
                rule.getId(),
                Map.of(
                        "policyId", policyId,
                        "effect", rule.getEffect(),
                        "precedence", rule.getPrecedence()));
        invalidateCacheAfterCommit(policyId);
        return rule;
    }

    private static void validateRegex(String regex) {
        if (regex == null || regex.isBlank()) {
            return;
        }
        try {
            Pattern.compile(regex);
        } catch (PatternSyntaxException exception) {
            throw new IllegalArgumentException("argumentRegex is invalid", exception);
        }
    }

    private static String emptyToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }

    private void invalidateCacheAfterCommit(UUID policyId) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    policyCache.invalidate(policyId);
                }
            });
        } else {
            policyCache.invalidate(policyId);
        }
    }
}
