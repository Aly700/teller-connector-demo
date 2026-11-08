package dev.affan.teller.domain;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AuditRecordRepository extends JpaRepository<AuditRecord, UUID>, AuditStore {
    List<AuditRecord> findByOccurredAtGreaterThanEqualAndOccurredAtLessThanOrderByOccurredAtAscIdAsc(
            Instant from,
            Instant to);

    List<AuditRecord> findByOccurredAtGreaterThanEqualAndOccurredAtLessThanOrderByOccurredAtDescIdDesc(
            Instant from,
            Instant to);

    @Override
    default AuditRecord storeAuditRecord(AuditRecord record) {
        return save(record);
    }

    @Override
    default java.util.Optional<AuditRecord> findAuditRecordById(UUID id) {
        return findById(id);
    }

    @Override
    default List<AuditRecord> findAuditRecords(Instant from, Instant to) {
        return findByOccurredAtGreaterThanEqualAndOccurredAtLessThanOrderByOccurredAtDescIdDesc(from, to);
    }
}
