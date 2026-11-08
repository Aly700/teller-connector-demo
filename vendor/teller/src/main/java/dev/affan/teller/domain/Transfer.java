package dev.affan.teller.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

@Entity
@Table(name = "transfers")
public class Transfer {

    @Id
    private UUID id;

    @Column(name = "idempotency_key", nullable = false, updatable = false, unique = true, length = 200)
    private String idempotencyKey;

    @Column(name = "from_account", nullable = false, updatable = false)
    private UUID fromAccountId;

    @Column(name = "to_account", nullable = false, updatable = false)
    private UUID toAccountId;

    @Column(name = "amount_minor", nullable = false, updatable = false)
    private long amountMinor;

    @Column(nullable = false, updatable = false, length = 3)
    private String currency;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private TransferState state;

    @Column(name = "reason_code", length = 64)
    private String reasonCode;

    @Column(name = "decision_id", nullable = false, updatable = false, unique = true)
    private UUID decisionId;

    @Column(name = "approval_id", unique = true)
    private UUID approvalId;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "posted_at")
    private Instant postedAt;

    @Column(name = "reversed_at")
    private Instant reversedAt;

    @Version
    private Long version;

    protected Transfer() {
    }

    private Transfer(
            UUID id,
            String idempotencyKey,
            UUID fromAccountId,
            UUID toAccountId,
            Money money,
            UUID decisionId,
            Instant createdAt) {
        this.id = Objects.requireNonNull(id, "id");
        if (idempotencyKey == null || idempotencyKey.isBlank()) {
            throw new IllegalArgumentException("idempotencyKey must not be blank");
        }
        this.idempotencyKey = idempotencyKey;
        this.fromAccountId = Objects.requireNonNull(fromAccountId, "fromAccountId");
        this.toAccountId = Objects.requireNonNull(toAccountId, "toAccountId");
        if (fromAccountId.equals(toAccountId)) {
            throw new IllegalArgumentException("transfer accounts must be different");
        }
        Money requiredMoney = Objects.requireNonNull(money, "money");
        if (requiredMoney.minorUnits() <= 0) {
            throw new IllegalArgumentException("transfer amountMinor must be positive");
        }
        this.amountMinor = requiredMoney.minorUnits();
        this.currency = requiredMoney.currency();
        this.decisionId = Objects.requireNonNull(decisionId, "decisionId");
        this.createdAt = Objects.requireNonNull(createdAt, "createdAt");
        this.state = TransferState.PENDING;
    }

    public static Transfer pending(
            UUID id,
            String idempotencyKey,
            UUID fromAccountId,
            UUID toAccountId,
            Money money,
            UUID decisionId,
            Instant createdAt) {
        return new Transfer(id, idempotencyKey, fromAccountId, toAccountId, money, decisionId, createdAt);
    }

    public void authorize() {
        requireState(TransferState.PENDING);
        state = TransferState.AUTHORIZED;
    }

    public void hold(UUID approvalId) {
        requireState(TransferState.PENDING);
        this.approvalId = Objects.requireNonNull(approvalId, "approvalId");
        state = TransferState.HELD;
    }

    public void deny(String reasonCode) {
        requireState(TransferState.PENDING);
        this.reasonCode = requireReason(reasonCode);
        state = TransferState.DENIED;
    }

    public void post(Instant at) {
        if (state != TransferState.AUTHORIZED && state != TransferState.HELD) {
            throw invalidTransition("POSTED");
        }
        state = TransferState.POSTED;
        postedAt = Objects.requireNonNull(at, "at");
        reasonCode = null;
    }

    public void reverse(String reasonCode, Instant at) {
        if (state != TransferState.HELD && state != TransferState.POSTED) {
            throw invalidTransition("REVERSED");
        }
        state = TransferState.REVERSED;
        this.reasonCode = requireReason(reasonCode);
        reversedAt = Objects.requireNonNull(at, "at");
    }

    private void requireState(TransferState expected) {
        if (state != expected) {
            throw invalidTransition(expected.name());
        }
    }

    private InvalidTransferTransitionException invalidTransition(String target) {
        return new InvalidTransferTransitionException("cannot transition transfer from " + state + " to " + target);
    }

    private static String requireReason(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("reasonCode must not be blank");
        }
        return value;
    }

    public UUID getId() { return id; }
    public String getIdempotencyKey() { return idempotencyKey; }
    public UUID getFromAccountId() { return fromAccountId; }
    public UUID getToAccountId() { return toAccountId; }
    public long getAmountMinor() { return amountMinor; }
    public String getCurrency() { return currency; }
    public TransferState getState() { return state; }
    public String getReasonCode() { return reasonCode; }
    public UUID getDecisionId() { return decisionId; }
    public UUID getApprovalId() { return approvalId; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getPostedAt() { return postedAt; }
    public Instant getReversedAt() { return reversedAt; }
    public long getVersion() { return version == null ? 0 : version; }
}
