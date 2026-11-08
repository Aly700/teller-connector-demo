package dev.affan.teller.export;

import dev.affan.teller.domain.AuditRecord;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

@Service
public class AuditExportService {

    private static final DateTimeFormatter OBJECT_STAMP =
            DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmss'Z'").withZone(ZoneOffset.UTC);

    private final AuditRecordSource auditRecords;
    private final AuditObjectStore objectStore;
    private final ObjectMapper objectMapper;

    public AuditExportService(
            AuditRecordSource auditRecords,
            AuditObjectStore objectStore,
            ObjectMapper objectMapper) {
        this.auditRecords = auditRecords;
        this.objectStore = objectStore;
        this.objectMapper = objectMapper;
    }

    public AuditExportResult export(LocalDate date) {
        Instant from = date.atStartOfDay().toInstant(ZoneOffset.UTC);
        return export(date, OBJECT_STAMP.format(from));
    }

    public AuditExportResult export(LocalDate date, String objectName) {
        Instant from = date.atStartOfDay().toInstant(ZoneOffset.UTC);
        Instant to = date.plusDays(1).atStartOfDay().toInstant(ZoneOffset.UTC);
        List<AuditRecord> records = auditRecords.find(from, to);
        String objectKey = "audit/dt=%s/%s.jsonl".formatted(date, requireObjectName(objectName));
        objectStore.put(objectKey, serialize(records));
        return new AuditExportResult(date, objectKey, records.size());
    }

    private static String requireObjectName(String value) {
        if (value == null || !value.matches("[A-Za-z0-9-]+")) {
            throw new IllegalArgumentException("objectName must contain only letters, digits, and hyphens");
        }
        return value;
    }

    private byte[] serialize(List<AuditRecord> records) {
        StringBuilder jsonLines = new StringBuilder();
        for (AuditRecord record : records) {
            Map<String, Object> value = new LinkedHashMap<>();
            value.put("id", record.getId());
            value.put("eventType", record.getEventType());
            value.put("aggregateType", record.getAggregateType());
            value.put("aggregateId", record.getAggregateId());
            value.put("occurredAt", record.getOccurredAt());
            value.put("details", objectMapper.readTree(record.getDetails()));
            jsonLines.append(objectMapper.writeValueAsString(value)).append('\n');
        }
        return jsonLines.toString().getBytes(StandardCharsets.UTF_8);
    }
}
