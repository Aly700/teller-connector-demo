package dev.affan.teller.export;

import static org.assertj.core.api.Assertions.assertThat;

import dev.affan.teller.domain.Entry;
import dev.affan.teller.domain.EntryDirection;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

class EntryExportServiceTest {

    @Test
    void writesDatePartitionedJsonLinesWithCurrencyTotals() {
        CapturingObjectStore objectStore = new CapturingObjectStore();
        UUID postingId = UUID.randomUUID();
        UUID transferId = UUID.randomUUID();
        UUID sourceId = UUID.randomUUID();
        UUID destinationId = UUID.randomUUID();
        Instant at = Instant.parse("2026-08-28T12:00:00Z");
        List<Entry> rows = List.of(
                Entry.create(UUID.randomUUID(), postingId, transferId, sourceId,
                        EntryDirection.DEBIT, 725, "USD", at),
                Entry.create(UUID.randomUUID(), postingId, transferId, destinationId,
                        EntryDirection.CREDIT, 725, "USD", at));

        EntryExportResult result = new EntryExportService(
                        (from, to) -> rows,
                        objectStore,
                        new ObjectMapper())
                .export(LocalDate.of(2026, 8, 28));

        assertThat(result.objectKey())
                .isEqualTo("entries/dt=2026-08-28/20260828T000000Z.jsonl");
        assertThat(result.recordCount()).isEqualTo(2);
        assertThat(result.totals().get("USD"))
                .isEqualTo(new EntryAmountTotals(1, 1, 725, 725));
        assertThat(new String(objectStore.content, StandardCharsets.UTF_8).lines())
                .hasSize(2)
                .allSatisfy(line -> assertThat(line).contains(
                        postingId.toString(), transferId.toString(), "USD", "725"));
    }

    private static final class CapturingObjectStore implements AuditObjectStore {
        private byte[] content;

        @Override
        public void put(String objectKey, byte[] jsonLines) {
            this.content = jsonLines;
        }

        @Override
        public byte[] get(String objectKey) {
            return content;
        }
    }
}
