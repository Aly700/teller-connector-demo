package dev.affan.teller.domain;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface TransferRepository extends JpaRepository<Transfer, UUID>, TransferStore {

    Optional<Transfer> findByApprovalId(UUID approvalId);

    long countByState(TransferState state);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<Transfer> findLockedByDecisionId(UUID decisionId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select transfer from Transfer transfer where transfer.id = :id")
    Optional<Transfer> findLockedById(@Param("id") UUID id);

    long countByFromAccountIdAndCreatedAtGreaterThanEqualAndStateNot(
            UUID fromAccountId,
            Instant createdAt,
            TransferState state);

    @Override
    default Transfer storeTransfer(Transfer transfer) {
        return save(transfer);
    }

    @Override
    default Optional<Transfer> findTransferById(UUID id) {
        return findById(id);
    }

    @Override
    default Optional<Transfer> findTransferByApprovalId(UUID approvalId) {
        return findByApprovalId(approvalId);
    }

    @Override
    default Optional<Transfer> findLockedTransferById(UUID id) {
        return findLockedById(id);
    }

    @Override
    default Optional<Transfer> findLockedTransferByDecisionId(UUID decisionId) {
        return findLockedByDecisionId(decisionId);
    }

    @Override
    default long countTransfers(UUID fromAccountId, Instant createdAt, TransferState excludedState) {
        return countByFromAccountIdAndCreatedAtGreaterThanEqualAndStateNot(
                fromAccountId, createdAt, excludedState);
    }

    @Override
    default java.util.List<Transfer> findAllTransfers() {
        return findAll();
    }

    @Override
    default long countTransfersByState(TransferState state) {
        return countByState(state);
    }

}
