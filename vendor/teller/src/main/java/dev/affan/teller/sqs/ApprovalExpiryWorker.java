package dev.affan.teller.sqs;

import dev.affan.teller.domain.ApprovalService;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class ApprovalExpiryWorker {

    private final ApprovalService approvalService;

    public ApprovalExpiryWorker(ApprovalService approvalService) {
        this.approvalService = approvalService;
    }

    @Scheduled(fixedDelayString = "${teller.approval.expiry-interval:PT1M}")
    public int expireStaleApprovals() {
        return approvalService.expireStale();
    }
}
