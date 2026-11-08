package dev.affan.teller.domain;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ApprovalRepository extends JpaRepository<Approval, UUID>, ApprovalStore {
    List<Approval> findByStatusOrderByCreatedAtAscIdAsc(ApprovalStatus status);

    List<Approval> findByStatusAndExpiresAtLessThanEqualOrderByExpiresAtAscIdAsc(
            ApprovalStatus status,
            Instant expiresAt);

    @Override
    default Approval storeApproval(Approval approval) {
        return save(approval);
    }

    @Override
    default java.util.Optional<Approval> findApprovalById(UUID id) {
        return findById(id);
    }

    @Override
    default List<Approval> findApprovals(ApprovalStatus status) {
        return findByStatusOrderByCreatedAtAscIdAsc(status);
    }

    @Override
    default List<Approval> findStaleApprovals(ApprovalStatus status, Instant expiresAt) {
        return findByStatusAndExpiresAtLessThanEqualOrderByExpiresAtAscIdAsc(status, expiresAt);
    }
}
