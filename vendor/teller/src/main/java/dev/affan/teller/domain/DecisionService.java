package dev.affan.teller.domain;

import dev.affan.teller.rules.ProposedCall;
import dev.affan.teller.rules.PolicyCache;
import dev.affan.teller.rules.RuleEvaluation;
import dev.affan.teller.rules.RulesEngine;
import dev.affan.teller.sqs.ApprovalMessage;
import dev.affan.teller.sqs.ApprovalMessageCodec;
import dev.affan.teller.sqs.OutboxMessage;
import dev.affan.teller.sqs.OutboxStore;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class DecisionService {

    private final PolicyCache policyCache;
    private final DecisionStore decisions;
    private final ApprovalStore approvals;
    private final RulesEngine rulesEngine;
    private final OutboxStore outbox;
    private final ApprovalMessageCodec approvalMessageCodec;
    private final AuditService auditService;
    private final Clock clock;
    private final Duration approvalTtl;

    public DecisionService(
            PolicyCache policyCache,
            DecisionStore decisions,
            ApprovalStore approvals,
            RulesEngine rulesEngine,
            OutboxStore outbox,
            ApprovalMessageCodec approvalMessageCodec,
            AuditService auditService,
            Clock clock,
            @Value("${teller.approval.ttl:PT30M}") Duration approvalTtl) {
        this.policyCache = policyCache;
        this.decisions = decisions;
        this.approvals = approvals;
        this.rulesEngine = rulesEngine;
        this.outbox = outbox;
        this.approvalMessageCodec = approvalMessageCodec;
        this.auditService = auditService;
        this.clock = clock;
        this.approvalTtl = approvalTtl;
    }

    @Transactional
    public DecisionOutcome evaluate(EvaluateDecisionCommand command) {
        PolicyCache.PolicyRules policyRules = policyCache.get(command.policyId());
        ProposedCall proposedCall = new ProposedCall(
                command.agentId(),
                command.toolName(),
                command.argumentsJson(),
                command.riskTier());
        return evaluate(policyRules, proposedCall, true);
    }

    DecisionOutcome evaluateTransfer(
            EvaluateTransferPolicyCommand command,
            boolean createApproval,
            PolicyCache.PolicyRules policyRules) {
        Policy policy = policyRules.policy();
        if (!policy.getId().equals(command.policyId()) || !policy.isActive()) {
            throw new ConflictException("transfer policy is no longer active");
        }
        Money money = command.money();
        String argumentsJson = ("{\"amountMinor\":%d,\"currency\":\"%s\","
                + "\"fromAccountId\":\"%s\",\"toAccountId\":\"%s\"}")
                .formatted(
                        money.minorUnits(),
                        money.currency(),
                        command.fromAccountId(),
                        command.toAccountId());
        ProposedCall proposedCall = new ProposedCall(
                command.initiatedBy(),
                "ledger.transfer",
                argumentsJson,
                RiskTier.MEDIUM,
                money.minorUnits(),
                money.currency(),
                command.fromAccountId(),
                command.toAccountId(),
                command.velocityCounts());
        return evaluate(policyRules, proposedCall, createApproval);
    }

    private DecisionOutcome evaluate(
            PolicyCache.PolicyRules policyRules,
            ProposedCall proposedCall,
            boolean createApproval) {
        Policy policy = policyRules.policy();
        RuleEvaluation evaluation = rulesEngine.evaluate(
                policyRules.rules().stream().map(Rule::toDefinition).toList(),
                proposedCall);
        Instant now = clock.instant();
        Decision decision = decisions.storeDecision(Decision.create(
                UUID.randomUUID(),
                policy.getId(),
                policy.getVersion(),
                proposedCall.agentId(),
                proposedCall.toolName(),
                proposedCall.argumentsJson(),
                proposedCall.riskTier(),
                evaluation.matchedRuleId().orElse(null),
                evaluation.effect(),
                now));
        auditDecision(decision);

        Approval approval = null;
        if (decision.getEffect() == Effect.REQUIRE_APPROVAL && createApproval) {
            approval = createApproval(decision, now);
        }
        return new DecisionOutcome(decision, approval);
    }

    @Transactional(readOnly = true)
    public Decision get(UUID id) {
        return decisions.findDecisionById(id)
                .orElseThrow(() -> new ResourceNotFoundException("decision", id));
    }

    private Approval createApproval(Decision decision, Instant now) {
        Approval approval = approvals.storeApproval(Approval.pending(
                UUID.randomUUID(),
                decision.getId(),
                now,
                now.plus(approvalTtl)));
        auditService.append(
                AuditEventType.APPROVAL_CREATED,
                "APPROVAL",
                approval.getId(),
                Map.of(
                        "decisionId", decision.getId(),
                        "expiresAt", approval.getExpiresAt()));
        UUID messageId = UUID.randomUUID();
        ApprovalMessage message = new ApprovalMessage(
                messageId, approval.getId(), decision.getId(), approval.getExpiresAt());
        outbox.storeOutboxMessage(OutboxMessage.pending(
                messageId,
                "APPROVAL",
                approval.getId(),
                approvalMessageCodec.encode(message),
                now));
        return approval;
    }

    private void auditDecision(Decision decision) {
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("policyId", decision.getPolicyId());
        details.put("policyVersion", decision.getPolicyVersion());
        details.put("effect", decision.getEffect());
        details.put("matchedRuleId", decision.getMatchedRuleId());
        auditService.append(
                AuditEventType.DECISION_CREATED,
                "DECISION",
                decision.getId(),
                details);
    }
}
