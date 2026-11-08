package dev.affan.teller.domain;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface ApprovalStore {

    Approval storeApproval(Approval approval);

    Optional<Approval> findApprovalById(UUID id);

    List<Approval> findApprovals(ApprovalStatus status);

    List<Approval> findStaleApprovals(ApprovalStatus status, Instant expiresAt);
}
