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
import org.springframework.data.domain.Persistable;

@Entity
@Immutable
@Table(name = "entries")
public class Entry implements Persistable<UUID> {

    @Id
    private UUID id;

    @Column(name = "posting_id", nullable = false, updatable = false)
    private UUID postingId;

    @Column(name = "transfer_id", updatable = false)
    private UUID transferId;

    @Column(name = "account_id", updatable = false)
    private UUID accountId;

    @Column(nullable = false, length = 3, updatable = false)
    private String currency;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, updatable = false)
    private EntryDirection direction;

    @Column(name = "amount_minor", nullable = false, updatable = false)
    private long amountMinor;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Transient
    private boolean newEntity = true;

    protected Entry() {
    }

    private Entry(
            UUID id,
            UUID postingId,
            UUID transferId,
            UUID accountId,
            EntryDirection direction,
            long amountMinor,
            String currency,
            Instant createdAt) {
        this.id = Objects.requireNonNull(id, "id");
        this.postingId = Objects.requireNonNull(postingId, "postingId");
        this.transferId = transferId;
        this.accountId = accountId;
        if (transferId != null && accountId == null) {
            throw new IllegalArgumentException("transfer entry accountId must not be null");
        }
        this.direction = Objects.requireNonNull(direction, "direction");
        if (amountMinor <= 0) {
            throw new IllegalArgumentException("entry amountMinor must be positive");
        }
        this.amountMinor = amountMinor;
        this.currency = Money.of(amountMinor, currency).currency();
        this.createdAt = Objects.requireNonNull(createdAt, "createdAt");
    }

    public static Entry create(
            UUID id,
            UUID postingId,
            UUID transferId,
            UUID accountId,
            EntryDirection direction,
            long amountMinor,
            String currency,
            Instant createdAt) {
        return new Entry(
                id,
                postingId,
                transferId,
                accountId,
                direction,
                amountMinor,
                currency,
                createdAt);
    }

    public long signedAmountMinor() {
        return direction.signed(amountMinor);
    }

    @Override
    public UUID getId() { return id; }

    @Override
    public boolean isNew() { return newEntity; }

    @PostLoad
    @PostPersist
    void markNotNew() { newEntity = false; }

    public UUID getPostingId() { return postingId; }
    public UUID getTransferId() { return transferId; }
    public UUID getAccountId() { return accountId; }
    public String getCurrency() { return currency; }
    public EntryDirection getDirection() { return direction; }
    public long getAmountMinor() { return amountMinor; }
    public Instant getCreatedAt() { return createdAt; }
}
