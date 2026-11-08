package dev.affan.teller.web;

import dev.affan.teller.domain.Approval;
import dev.affan.teller.domain.ApprovalService;
import dev.affan.teller.domain.ApprovalQueueService;
import dev.affan.teller.domain.ApprovalQueueService.ApprovalTransferDetails;
import dev.affan.teller.domain.ApprovalStatus;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.UUID;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/approvals")
public class ApprovalController {

    private final ApprovalService approvalService;
    private final ApprovalQueueService approvalQueueService;

    public ApprovalController(ApprovalService approvalService, ApprovalQueueService approvalQueueService) {
        this.approvalService = approvalService;
        this.approvalQueueService = approvalQueueService;
    }

    @GetMapping
    java.util.List<ApprovalResponse> list(
            @RequestParam(defaultValue = "PENDING") ApprovalStatus status) {
        return approvalQueueService.findApprovals(status).stream()
                .map(ApprovalResponse::from)
                .toList();
    }

    @GetMapping("/{id}/transfer")
    ApprovalTransferResponse transfer(@PathVariable UUID id) {
        return ApprovalTransferResponse.from(approvalQueueService.getTransfer(id));
    }

    @PostMapping("/{id}/approve")
    ApprovalResponse approve(
            @PathVariable UUID id,
            @Valid @RequestBody DecideApprovalRequest request) {
        return ApprovalResponse.from(approvalService.approve(id, request.decidedBy(), request.reason()));
    }

    @PostMapping("/{id}/deny")
    ApprovalResponse deny(
            @PathVariable UUID id,
            @Valid @RequestBody DecideApprovalRequest request) {
        return ApprovalResponse.from(approvalService.deny(id, request.decidedBy(), request.reason()));
    }

    public record DecideApprovalRequest(
            @NotBlank @Size(max = 160) String decidedBy,
            @Size(max = 500) String reason) {
    }

    public record ApprovalResponse(
            UUID id,
            UUID decisionId,
            ApprovalStatus status,
            String decidedBy,
            String reason,
            Instant decidedAt,
            Instant expiresAt,
            Instant createdAt) {

        static ApprovalResponse from(Approval approval) {
            return new ApprovalResponse(
                    approval.getId(),
                    approval.getDecisionId(),
                    approval.getStatus(),
                    approval.getDecidedBy(),
                    approval.getReason(),
                    approval.getDecidedAt(),
                    approval.getExpiresAt(),
                    approval.getCreatedAt());
        }
    }

    public record ApprovalTransferResponse(
            UUID transferId,
            String amountMinor,
            String currency,
            UUID fromAccountId,
            UUID toAccountId,
            dev.affan.teller.domain.TransferState state,
            UUID decisionId,
            UUID matchedRuleId,
            Instant createdAt) {

        static ApprovalTransferResponse from(ApprovalTransferDetails details) {
            return new ApprovalTransferResponse(
                    details.transferId(),
                    Long.toString(details.amountMinor()),
                    details.currency(),
                    details.fromAccountId(),
                    details.toAccountId(),
                    details.state(),
                    details.decisionId(),
                    details.matchedRuleId(),
                    details.createdAt());
        }
    }
}
