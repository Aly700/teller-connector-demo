package dev.affan.teller.export;

import dev.affan.teller.domain.AuditRecord;
import dev.affan.teller.domain.AuditRecordRepository;
import java.time.Instant;
import java.util.List;
import org.springframework.stereotype.Component;

@Component
public class JpaAuditRecordSource implements AuditRecordSource {

    private final AuditRecordRepository auditRecords;

    public JpaAuditRecordSource(AuditRecordRepository auditRecords) {
        this.auditRecords = auditRecords;
    }

    @Override
    public List<AuditRecord> find(Instant from, Instant to) {
        return auditRecords.findByOccurredAtGreaterThanEqualAndOccurredAtLessThanOrderByOccurredAtAscIdAsc(from, to);
    }
}
