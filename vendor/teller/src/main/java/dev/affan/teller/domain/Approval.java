package dev.affan.teller.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Objects;
import java.util.UUID;

@Entity
@Table(name = "approvals")
public class Approval {

    @Id
    private UUID id;

    @Column(name = "decision_id", nullable = false, updatable = false, unique = true)
    private UUID decisionId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private ApprovalStatus status;

    @Column(name = "decided_by")
    private String decidedBy;

    @Column(length = 500)
    private String reason;

    @Column(name = "decided_at")
    private Instant decidedAt;

    @Column(name = "expires_at", nullable = false, updatable = false)
    private Instant expiresAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Version
    private Long version;

    protected Approval() {
    }

    private Approval(UUID id, UUID decisionId, Instant createdAt, Instant expiresAt) {
        this.id = Objects.requireNonNull(id, "id");
        this.decisionId = Objects.requireNonNull(decisionId, "decisionId");
        this.createdAt = Objects.requireNonNull(createdAt, "createdAt").truncatedTo(ChronoUnit.MICROS);
        this.expiresAt = Objects.requireNonNull(expiresAt, "expiresAt").truncatedTo(ChronoUnit.MICROS);
        if (!this.expiresAt.isAfter(this.createdAt)) {
            throw new IllegalArgumentException("expiresAt must be after createdAt");
        }
        this.status = ApprovalStatus.PENDING;
    }

    public static Approval pending(UUID id, UUID decisionId, Instant createdAt, Instant expiresAt) {
        return new Approval(id, decisionId, createdAt, expiresAt);
    }

    public void approve(String reviewer, Instant at) {
        approve(reviewer, null, at);
    }

    public void approve(String reviewer, String reason, Instant at) {
        decide(ApprovalStatus.APPROVED, reviewer, reason, at);
    }

    public void deny(String reviewer, Instant at) {
        deny(reviewer, null, at);
    }

    public void deny(String reviewer, String reason, Instant at) {
        decide(ApprovalStatus.DENIED, reviewer, reason, at);
    }

    public void expire(Instant at) {
        requirePending();
        Objects.requireNonNull(at, "at");
        if (at.isBefore(expiresAt)) {
            throw new InvalidApprovalTransitionException("approval is not expired");
        }
        status = ApprovalStatus.EXPIRED;
        decidedAt = at;
    }

    private void decide(ApprovalStatus terminalStatus, String reviewer, String reason, Instant at) {
        requirePending();
        if (reviewer == null || reviewer.isBlank()) {
            throw new IllegalArgumentException("decidedBy must not be blank");
        }
        Instant decidedAt = Objects.requireNonNull(at, "at");
        if (!decidedAt.isBefore(expiresAt)) {
            throw new InvalidApprovalTransitionException("approval is expired");
        }
        status = terminalStatus;
        decidedBy = reviewer.trim();
        this.reason = normalizeReason(reason);
        this.decidedAt = decidedAt;
    }

    private static String normalizeReason(String reason) {
        if (reason == null || reason.isBlank()) {
            return null;
        }
        String normalized = reason.trim();
        if (normalized.length() > 500) {
            throw new IllegalArgumentException("reason must not exceed 500 characters");
        }
        return normalized;
    }

    private void requirePending() {
        if (status != ApprovalStatus.PENDING) {
            throw new InvalidApprovalTransitionException("cannot transition approval from " + status);
        }
    }

    public UUID getId() {
        return id;
    }

    public UUID getDecisionId() {
        return decisionId;
    }

    public ApprovalStatus getStatus() {
        return status;
    }

    public String getDecidedBy() {
        return decidedBy;
    }

    public String getReason() {
        return reason;
    }

    public Instant getDecidedAt() {
        return decidedAt;
    }

    public Instant getExpiresAt() {
        return expiresAt;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
