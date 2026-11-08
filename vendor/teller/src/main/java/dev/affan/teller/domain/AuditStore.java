package dev.affan.teller.domain;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface AuditStore {

    AuditRecord storeAuditRecord(AuditRecord record);

    Optional<AuditRecord> findAuditRecordById(UUID id);

    List<AuditRecord> findAuditRecords(Instant from, Instant to);
}
