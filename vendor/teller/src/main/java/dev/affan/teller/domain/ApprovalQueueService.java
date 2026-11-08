package dev.affan.teller.domain;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ApprovalQueueService {

    private final ApprovalStore approvals;
    private final TransferStore transfers;
    private final DecisionStore decisions;

    public ApprovalQueueService(
            ApprovalStore approvals,
            TransferStore transfers,
            DecisionStore decisions) {
        this.approvals = approvals;
        this.transfers = transfers;
        this.decisions = decisions;
    }

    @Transactional(readOnly = true)
    public List<Approval> findApprovals(ApprovalStatus status) {
        return approvals.findApprovals(status);
    }

    @Transactional(readOnly = true)
    public ApprovalTransferDetails getTransfer(UUID approvalId) {
        Approval approval = approvals.findApprovalById(approvalId)
                .orElseThrow(() -> new ResourceNotFoundException("approval", approvalId));
        Transfer transfer = transfers.findTransferByApprovalId(approval.getId())
                .orElseThrow(() -> new ResourceNotFoundException("transfer for approval", approvalId));
        Decision decision = decisions.findDecisionById(approval.getDecisionId())
                .orElseThrow(() -> new ResourceNotFoundException("decision", approval.getDecisionId()));
        return new ApprovalTransferDetails(
                transfer.getId(),
                transfer.getAmountMinor(),
                transfer.getCurrency(),
                transfer.getFromAccountId(),
                transfer.getToAccountId(),
                transfer.getState(),
                transfer.getDecisionId(),
                decision.getMatchedRuleId(),
                transfer.getCreatedAt());
    }

    public record ApprovalTransferDetails(
            UUID transferId,
            long amountMinor,
            String currency,
            UUID fromAccountId,
            UUID toAccountId,
            TransferState state,
            UUID decisionId,
            UUID matchedRuleId,
            Instant createdAt) {
    }
}
