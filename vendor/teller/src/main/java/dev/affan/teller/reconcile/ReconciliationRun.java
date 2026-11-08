package dev.affan.teller.reconcile;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Objects;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "reconciliation_runs")
public class ReconciliationRun {

    @Id
    private UUID id;

    @Column(name = "business_date", nullable = false, updatable = false)
    private LocalDate businessDate;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, updatable = false)
    private ReconciliationStatus status;

    @Column(name = "entry_object_key", nullable = false, updatable = false)
    private String entryObjectKey;

    @Column(name = "audit_object_key", nullable = false, updatable = false)
    private String auditObjectKey;

    @Column(name = "database_row_count", nullable = false, updatable = false)
    private int databaseRowCount;

    @Column(name = "export_row_count", nullable = false, updatable = false)
    private int exportRowCount;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false, updatable = false, columnDefinition = "jsonb")
    private String details;

    @Column(name = "completed_at", nullable = false, updatable = false)
    private Instant completedAt;

    protected ReconciliationRun() {
    }

    private ReconciliationRun(
            UUID id,
            LocalDate businessDate,
            ReconciliationStatus status,
            String entryObjectKey,
            String auditObjectKey,
            int databaseRowCount,
            int exportRowCount,
            String details,
            Instant completedAt) {
        this.id = Objects.requireNonNull(id, "id");
        this.businessDate = Objects.requireNonNull(businessDate, "businessDate");
        this.status = Objects.requireNonNull(status, "status");
        this.entryObjectKey = Objects.requireNonNull(entryObjectKey, "entryObjectKey");
        this.auditObjectKey = Objects.requireNonNull(auditObjectKey, "auditObjectKey");
        this.databaseRowCount = databaseRowCount;
        this.exportRowCount = exportRowCount;
        this.details = Objects.requireNonNull(details, "details");
        this.completedAt = Objects.requireNonNull(completedAt, "completedAt");
    }

    public static ReconciliationRun completed(
            UUID id,
            LocalDate businessDate,
            ReconciliationStatus status,
            String entryObjectKey,
            String auditObjectKey,
            int databaseRowCount,
            int exportRowCount,
            String details,
            Instant completedAt) {
        return new ReconciliationRun(
                id,
                businessDate,
                status,
                entryObjectKey,
                auditObjectKey,
                databaseRowCount,
                exportRowCount,
                details,
                completedAt);
    }

    public UUID getId() { return id; }
    public LocalDate getBusinessDate() { return businessDate; }
    public ReconciliationStatus getStatus() { return status; }
    public String getEntryObjectKey() { return entryObjectKey; }
    public String getAuditObjectKey() { return auditObjectKey; }
    public int getDatabaseRowCount() { return databaseRowCount; }
    public int getExportRowCount() { return exportRowCount; }
    public String getDetails() { return details; }
    public Instant getCompletedAt() { return completedAt; }
}
