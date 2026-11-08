package dev.affan.teller.web;

import dev.affan.teller.domain.AuditEventType;
import dev.affan.teller.domain.AuditRecord;
import dev.affan.teller.domain.AuditService;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@RestController
@RequestMapping("/audit")
public class AuditController {

    private final AuditService auditService;
    private final ObjectMapper objectMapper;

    public AuditController(AuditService auditService, ObjectMapper objectMapper) {
        this.auditService = auditService;
        this.objectMapper = objectMapper;
    }

    @GetMapping
    List<AuditResponse> query(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant from,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant to) {
        return auditService.query(from, to).stream()
                .map(record -> AuditResponse.from(record, objectMapper))
                .toList();
    }

    public record AuditResponse(
            UUID id,
            AuditEventType eventType,
            String aggregateType,
            UUID aggregateId,
            Instant occurredAt,
            JsonNode details) {

        static AuditResponse from(AuditRecord record, ObjectMapper objectMapper) {
            return new AuditResponse(
                    record.getId(),
                    record.getEventType(),
                    record.getAggregateType(),
                    record.getAggregateId(),
                    record.getOccurredAt(),
                    objectMapper.readTree(record.getDetails()));
        }
    }
}
