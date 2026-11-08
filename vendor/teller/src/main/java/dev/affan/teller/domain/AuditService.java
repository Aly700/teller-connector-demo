package dev.affan.teller.domain;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

@Service
public class AuditService {

    private final AuditStore auditRecords;
    private final ObjectMapper objectMapper;
    private final Clock clock;

    public AuditService(AuditStore auditRecords, ObjectMapper objectMapper, Clock clock) {
        this.auditRecords = auditRecords;
        this.objectMapper = objectMapper;
        this.clock = clock;
    }

    @Transactional
    public AuditRecord append(
            AuditEventType eventType,
            String aggregateType,
            UUID aggregateId,
            Map<String, ?> details) {
        AuditRecord record = AuditRecord.create(
                UUID.randomUUID(),
                eventType,
                aggregateType,
                aggregateId,
                clock.instant(),
                objectMapper.writeValueAsString(details));
        return auditRecords.storeAuditRecord(record);
    }

    @Transactional
    public AuditRecord appendOnce(
            UUID recordId,
            AuditEventType eventType,
            String aggregateType,
            UUID aggregateId,
            Map<String, ?> details) {
        return auditRecords.findAuditRecordById(recordId)
                .orElseGet(() -> auditRecords.storeAuditRecord(AuditRecord.create(
                        recordId,
                        eventType,
                        aggregateType,
                        aggregateId,
                        clock.instant(),
                        objectMapper.writeValueAsString(details))));
    }

    @Transactional(readOnly = true)
    public List<AuditRecord> query(Instant from, Instant to) {
        if (from == null || to == null || !from.isBefore(to)) {
            throw new IllegalArgumentException("from must be before to");
        }
        return auditRecords.findAuditRecords(from, to);
    }
}
