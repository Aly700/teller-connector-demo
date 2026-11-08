package dev.affan.teller.reconcile;

import dev.affan.teller.domain.AccountStore;
import dev.affan.teller.domain.AuditEventType;
import dev.affan.teller.domain.AuditService;
import dev.affan.teller.domain.Entry;
import dev.affan.teller.domain.EntryStore;
import dev.affan.teller.domain.ResourceNotFoundException;
import dev.affan.teller.export.AuditObjectStore;
import dev.affan.teller.export.DailyExportResult;
import dev.affan.teller.export.EntryExportRow;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

@Service
public class ReconciliationService {

    private final AccountStore accounts;
    private final EntryStore entries;
    private final AuditObjectStore objectStore;
    private final ReconciliationComparator comparator;
    private final ReconciliationRunStore runs;
    private final AuditService auditService;
    private final Counter mismatchCounter;
    private final ObjectMapper objectMapper;
    private final Clock clock;

    public ReconciliationService(
            AccountStore accounts,
            EntryStore entries,
            AuditObjectStore objectStore,
            ReconciliationComparator comparator,
            ReconciliationRunStore runs,
            AuditService auditService,
            MeterRegistry meterRegistry,
            ObjectMapper objectMapper,
            Clock clock) {
        this.accounts = accounts;
        this.entries = entries;
        this.objectStore = objectStore;
        this.comparator = comparator;
        this.runs = runs;
        this.auditService = auditService;
        this.mismatchCounter = meterRegistry.counter("teller.reconciliation.mismatch");
        this.objectMapper = objectMapper;
        this.clock = clock;
    }

    @Transactional
    public ReconciliationRun reconcile(DailyExportResult export) {
        Instant from = export.date().atStartOfDay().toInstant(ZoneOffset.UTC);
        Instant to = export.date().plusDays(1).atStartOfDay().toInstant(ZoneOffset.UTC);
        List<EntryExportRow> exportedEntries = parseEntries(
                objectStore.get(export.entries().objectKey()));
        ReconciliationComparison comparison = comparator.compare(
                accounts.findAllAccounts(),
                entries.findAllEntries(),
                entries.findEntries(from, to),
                exportedEntries);
        ReconciliationStatus status = comparison.matched()
                ? ReconciliationStatus.MATCHED
                : ReconciliationStatus.MISMATCH;
        UUID runId = UUID.randomUUID();
        String details = objectMapper.writeValueAsString(comparison);
        ReconciliationRun run = runs.storeReconciliationRun(ReconciliationRun.completed(
                runId,
                export.date(),
                status,
                export.entries().objectKey(),
                export.audit().objectKey(),
                comparison.databaseRowCount(),
                comparison.exportRowCount(),
                details,
                clock.instant()));
        if (!comparison.matched()) {
            mismatchCounter.increment();
            Map<String, Object> auditDetails = new LinkedHashMap<>();
            auditDetails.put("businessDate", export.date());
            auditDetails.put("entryObjectKey", export.entries().objectKey());
            auditDetails.put("mismatches", comparison.mismatches());
            auditService.append(
                    AuditEventType.RECONCILIATION_MISMATCH,
                    "RECONCILIATION",
                    runId,
                    auditDetails);
        }
        return run;
    }

    @Transactional(readOnly = true)
    public ReconciliationRun latest() {
        return runs.latestReconciliationRun()
                .orElseThrow(() -> new ResourceNotFoundException("reconciliation", "latest"));
    }

    private List<EntryExportRow> parseEntries(byte[] jsonLines) {
        return Arrays.stream(new String(jsonLines, StandardCharsets.UTF_8).split("\\R"))
                .filter(line -> !line.isBlank())
                .map(line -> objectMapper.readValue(line, EntryExportRow.class))
                .toList();
    }
}
