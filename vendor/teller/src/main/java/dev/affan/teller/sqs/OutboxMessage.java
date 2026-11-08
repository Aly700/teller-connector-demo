package dev.affan.teller.sqs;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PostLoad;
import jakarta.persistence.PostPersist;
import jakarta.persistence.Table;
import jakarta.persistence.Transient;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import org.springframework.data.domain.Persistable;

@Entity
@Table(name = "outbox_messages")
public class OutboxMessage implements Persistable<UUID> {

    @Id
    private UUID id;

    @Column(name = "aggregate_type", nullable = false, updatable = false)
    private String aggregateType;

    @Column(name = "aggregate_id", nullable = false, updatable = false)
    private UUID aggregateId;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false, updatable = false, columnDefinition = "jsonb")
    private String payload;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "sent_at")
    private Instant sentAt;

    @Column(nullable = false)
    private int attempts;

    @Column(name = "last_error")
    private String lastError;

    @Transient
    private boolean newEntity = true;

    protected OutboxMessage() {
    }

    private OutboxMessage(
            UUID id,
            String aggregateType,
            UUID aggregateId,
            String payload,
            Instant createdAt) {
        this.id = Objects.requireNonNull(id, "id");
        this.aggregateType = Objects.requireNonNull(aggregateType, "aggregateType");
        this.aggregateId = Objects.requireNonNull(aggregateId, "aggregateId");
        this.payload = Objects.requireNonNull(payload, "payload");
        this.createdAt = Objects.requireNonNull(createdAt, "createdAt");
    }

    public static OutboxMessage pending(
            UUID id,
            String aggregateType,
            UUID aggregateId,
            String payload,
            Instant createdAt) {
        return new OutboxMessage(id, aggregateType, aggregateId, payload, createdAt);
    }

    public void markSent(Instant at) {
        if (sentAt != null) {
            throw new IllegalStateException("outbox message is already sent");
        }
        attempts++;
        sentAt = Objects.requireNonNull(at, "at");
        lastError = null;
    }

    public void markFailed(String error) {
        if (sentAt != null) {
            throw new IllegalStateException("sent outbox message cannot fail");
        }
        attempts++;
        lastError = Objects.requireNonNull(error, "error");
    }

    @Override
    public UUID getId() {
        return id;
    }

    @Override
    public boolean isNew() {
        return newEntity;
    }

    @PostLoad
    @PostPersist
    void markNotNew() {
        newEntity = false;
    }

    public String getAggregateType() {
        return aggregateType;
    }

    public UUID getAggregateId() {
        return aggregateId;
    }

    public String getPayload() {
        return payload;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getSentAt() {
        return sentAt;
    }

    public int getAttempts() {
        return attempts;
    }

    public String getLastError() {
        return lastError;
    }
}
