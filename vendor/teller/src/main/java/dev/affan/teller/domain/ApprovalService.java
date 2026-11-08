package dev.affan.teller.domain;

import dev.affan.teller.sqs.ApprovalMessage;
import dev.affan.teller.sqs.ApprovalMessageProcessor;
import dev.affan.teller.sqs.ApprovalMessageValidator;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ApprovalService implements ApprovalMessageProcessor {

    private final ApprovalStore approvals;
    private final AuditService auditService;
    private final Clock clock;
    private final ApprovalMessageValidator messageValidator;
    private final ApprovalLifecycleListener lifecycleListener;

    public ApprovalService(
            ApprovalStore approvals,
            AuditService auditService,
            Clock clock,
            ApprovalMessageValidator messageValidator) {
        this(approvals, auditService, clock, messageValidator, ApprovalLifecycleListener.NOOP);
    }

    @Autowired
    public ApprovalService(
            ApprovalStore approvals,
            AuditService auditService,
            Clock clock,
            ApprovalMessageValidator messageValidator,
            ApprovalLifecycleListener lifecycleListener) {
        this.approvals = approvals;
        this.auditService = auditService;
        this.clock = clock;
        this.messageValidator = messageValidator;
        this.lifecycleListener = lifecycleListener;
    }

    @Transactional
    public Approval approve(UUID id, String decidedBy) {
        return approve(id, decidedBy, null);
    }

    @Transactional
    public Approval approve(UUID id, String decidedBy, String reason) {
        Approval approval = requireApproval(id);
        approval.approve(decidedBy, reason, clock.instant());
        lifecycleListener.approved(approval.getDecisionId());
        audit(approval, AuditEventType.APPROVAL_APPROVED);
        return approval;
    }

    @Transactional
    public Approval deny(UUID id, String decidedBy) {
        return deny(id, decidedBy, null);
    }

    @Transactional
    public Approval deny(UUID id, String decidedBy, String reason) {
        Approval approval = requireApproval(id);
        approval.deny(decidedBy, reason, clock.instant());
        lifecycleListener.rejected(approval.getDecisionId(), "APPROVAL_DENIED");
        audit(approval, AuditEventType.APPROVAL_DENIED);
        return approval;
    }

    @Transactional
    public int expireStale() {
        Instant now = clock.instant();
        List<Approval> stale = approvals.findStaleApprovals(
                ApprovalStatus.PENDING,
                now);
        stale.forEach(approval -> {
            approval.expire(now);
            lifecycleListener.rejected(approval.getDecisionId(), "APPROVAL_EXPIRED");
            audit(approval, AuditEventType.APPROVAL_EXPIRED);
        });
        return stale.size();
    }

    @Override
    @Transactional
    public void process(ApprovalMessage message) {
        Approval approval = requireApproval(message.approvalId());
        messageValidator.validate(message, approval);
        if (approval.getStatus() != ApprovalStatus.PENDING) {
            return;
        }
        Instant now = clock.instant();
        if (!now.isBefore(approval.getExpiresAt())) {
            approval.expire(now);
            lifecycleListener.rejected(approval.getDecisionId(), "APPROVAL_EXPIRED");
            audit(approval, AuditEventType.APPROVAL_EXPIRED);
        }
    }

    private Approval requireApproval(UUID id) {
        return approvals.findApprovalById(id)
                .orElseThrow(() -> new ResourceNotFoundException("approval", id));
    }

    private void audit(Approval approval, AuditEventType eventType) {
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("decisionId", approval.getDecisionId());
        details.put("status", approval.getStatus());
        if (approval.getDecidedBy() != null) {
            details.put("decidedBy", approval.getDecidedBy());
        }
        if (approval.getReason() != null) {
            details.put("reason", approval.getReason());
        }
        auditService.append(
                eventType,
                "APPROVAL",
                approval.getId(),
                details);
    }
}
