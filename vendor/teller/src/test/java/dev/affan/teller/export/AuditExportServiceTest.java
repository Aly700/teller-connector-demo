package dev.affan.teller.export;

import static org.assertj.core.api.Assertions.assertThat;
import dev.affan.teller.domain.AuditEventType;
import dev.affan.teller.domain.AuditRecord;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

class AuditExportServiceTest {

    @Test
    void writesToTheDatePartitionedObjectKey() {
        CapturingObjectStore objectStore = new CapturingObjectStore();
        LocalDate date = LocalDate.of(2026, 8, 28);
        AuditRecordSource source = (from, to) -> {
            assertThat(from).isEqualTo(Instant.parse("2026-08-28T00:00:00Z"));
            assertThat(to).isEqualTo(Instant.parse("2026-08-29T00:00:00Z"));
            return List.of();
        };

        AuditExportResult result = new AuditExportService(source, objectStore, new ObjectMapper()).export(date);

        assertThat(result.objectKey()).isEqualTo("audit/dt=2026-08-28/20260828T000000Z.jsonl");
        assertThat(objectStore.key).isEqualTo(result.objectKey());
    }

    @Test
    void usesTheSameObjectKeyForRepeatedExportsOfADay() {
        CapturingObjectStore objectStore = new CapturingObjectStore();
        AuditExportService service = new AuditExportService(
                (from, to) -> List.of(),
                objectStore,
                new ObjectMapper());

        AuditExportResult first = service.export(LocalDate.of(2026, 8, 28));
        AuditExportResult second = service.export(LocalDate.of(2026, 8, 28));

        assertThat(second.objectKey()).isEqualTo(first.objectKey());
    }

    @Test
    void writesOneOrderedJsonObjectPerLine() {
        CapturingObjectStore objectStore = new CapturingObjectStore();
        AuditRecord first = record("2026-08-28T00:00:01Z", AuditEventType.POLICY_CREATED);
        AuditRecord second = record("2026-08-28T00:00:02Z", AuditEventType.RULE_CREATED);
        AuditRecordSource source = (from, to) -> List.of(first, second);

        AuditExportResult result = new AuditExportService(source, objectStore, new ObjectMapper())
                .export(LocalDate.of(2026, 8, 28));

        String[] lines = new String(objectStore.content, StandardCharsets.UTF_8).split("\\n");
        assertThat(result.recordCount()).isEqualTo(2);
        assertThat(lines).hasSize(2);
        assertThat(lines[0]).contains(first.getId().toString(), "POLICY_CREATED");
        assertThat(lines[1]).contains(second.getId().toString(), "RULE_CREATED");
    }

    private static AuditRecord record(String occurredAt, AuditEventType eventType) {
        return AuditRecord.create(
                UUID.randomUUID(),
                eventType,
                "POLICY",
                UUID.randomUUID(),
                Instant.parse(occurredAt),
                "{\"source\":\"test\"}");
    }

    private static final class CapturingObjectStore implements AuditObjectStore {
        private String key;
        private byte[] content;

        @Override
        public void put(String objectKey, byte[] jsonLines) {
            this.key = objectKey;
            this.content = jsonLines;
        }
    }
}
