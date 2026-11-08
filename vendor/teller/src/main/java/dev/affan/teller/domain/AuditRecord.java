package dev.affan.teller.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.PostLoad;
import jakarta.persistence.PostPersist;
import jakarta.persistence.Table;
import jakarta.persistence.Transient;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;
import org.hibernate.annotations.Immutable;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import org.springframework.data.domain.Persistable;

@Entity
@Immutable
@Table(name = "audit_records")
public class AuditRecord implements Persistable<UUID> {

    @Id
    private UUID id;

    @Enumerated(EnumType.STRING)
    @Column(name = "event_type", nullable = false, updatable = false)
    private AuditEventType eventType;

    @Column(name = "aggregate_type", nullable = false, updatable = false)
    private String aggregateType;

    @Column(name = "aggregate_id", nullable = false, updatable = false)
    private UUID aggregateId;

    @Column(name = "occurred_at", nullable = false, updatable = false)
    private Instant occurredAt;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false, updatable = false, columnDefinition = "jsonb")
    private String details;

    @Transient
    private boolean newEntity = true;

    protected AuditRecord() {
    }

    private AuditRecord(
            UUID id,
            AuditEventType eventType,
            String aggregateType,
            UUID aggregateId,
            Instant occurredAt,
            String details) {
        this.id = Objects.requireNonNull(id, "id");
        this.eventType = Objects.requireNonNull(eventType, "eventType");
        this.aggregateType = Objects.requireNonNull(aggregateType, "aggregateType");
        this.aggregateId = Objects.requireNonNull(aggregateId, "aggregateId");
        this.occurredAt = Objects.requireNonNull(occurredAt, "occurredAt");
        this.details = Objects.requireNonNull(details, "details");
    }

    public static AuditRecord create(
            UUID id,
            AuditEventType eventType,
            String aggregateType,
            UUID aggregateId,
            Instant occurredAt,
            String details) {
        return new AuditRecord(id, eventType, aggregateType, aggregateId, occurredAt, details);
    }

    @Override
    public UUID getId() { return id; }

    @Override
    public boolean isNew() { return newEntity; }

    @PostLoad
    @PostPersist
    void markNotNew() { newEntity = false; }

    public AuditEventType getEventType() { return eventType; }
    public String getAggregateType() { return aggregateType; }
    public UUID getAggregateId() { return aggregateId; }
    public Instant getOccurredAt() { return occurredAt; }
    public String getDetails() { return details; }
}
