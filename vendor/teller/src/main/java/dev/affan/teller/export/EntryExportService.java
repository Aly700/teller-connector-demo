package dev.affan.teller.export;

import dev.affan.teller.domain.Entry;
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
public class EntryExportService {

    private static final DateTimeFormatter OBJECT_STAMP =
            DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmss'Z'").withZone(ZoneOffset.UTC);

    private final EntryRecordSource entries;
    private final AuditObjectStore objectStore;
    private final ObjectMapper objectMapper;

    public EntryExportService(
            EntryRecordSource entries,
            AuditObjectStore objectStore,
            ObjectMapper objectMapper) {
        this.entries = entries;
        this.objectStore = objectStore;
        this.objectMapper = objectMapper;
    }

    public EntryExportResult export(LocalDate date) {
        Instant from = date.atStartOfDay().toInstant(ZoneOffset.UTC);
        return export(date, OBJECT_STAMP.format(from));
    }

    public EntryExportResult export(LocalDate date, String objectName) {
        Instant from = date.atStartOfDay().toInstant(ZoneOffset.UTC);
        Instant to = date.plusDays(1).atStartOfDay().toInstant(ZoneOffset.UTC);
        List<Entry> records = entries.find(from, to);
        String objectKey = "entries/dt=%s/%s.jsonl".formatted(date, requireObjectName(objectName));
        objectStore.put(objectKey, serialize(records));
        return new EntryExportResult(date, objectKey, records.size(), totals(records));
    }

    private static String requireObjectName(String value) {
        if (value == null || !value.matches("[A-Za-z0-9-]+")) {
            throw new IllegalArgumentException("objectName must contain only letters, digits, and hyphens");
        }
        return value;
    }

    private byte[] serialize(List<Entry> records) {
        StringBuilder jsonLines = new StringBuilder();
        for (Entry record : records) {
            jsonLines.append(objectMapper.writeValueAsString(EntryExportRow.from(record))).append('\n');
        }
        return jsonLines.toString().getBytes(StandardCharsets.UTF_8);
    }

    static Map<String, EntryAmountTotals> totals(List<Entry> records) {
        Map<String, EntryAmountTotals> totals = new LinkedHashMap<>();
        for (Entry entry : records) {
            totals.compute(
                    entry.getCurrency(),
                    (currency, current) -> (current == null ? EntryAmountTotals.zero() : current)
                            .add(entry.getDirection(), entry.getAmountMinor()));
        }
        return Map.copyOf(totals);
    }
}
