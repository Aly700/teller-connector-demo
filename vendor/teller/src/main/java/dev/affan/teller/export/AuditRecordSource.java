package dev.affan.teller.export;

import dev.affan.teller.domain.AuditRecord;
import java.time.Instant;
import java.util.List;

@FunctionalInterface
public interface AuditRecordSource {
    List<AuditRecord> find(Instant from, Instant to);
}
