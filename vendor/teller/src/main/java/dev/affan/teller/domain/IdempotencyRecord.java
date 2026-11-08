package dev.affan.teller.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.Objects;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "idempotency_records")
public class IdempotencyRecord {

    @Id
    @Column(name = "key", nullable = false, updatable = false, length = 200)
    private String key;

    @Column(name = "request_hash", nullable = false, updatable = false, length = 64)
    private String requestHash;

    @Column(name = "status_code")
    private Integer statusCode;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "response_body", columnDefinition = "jsonb")
    private String responseBody;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected IdempotencyRecord() {
    }

    private IdempotencyRecord(String key, String requestHash, Instant createdAt) {
        this.key = Objects.requireNonNull(key, "key");
        this.requestHash = Objects.requireNonNull(requestHash, "requestHash");
        this.createdAt = Objects.requireNonNull(createdAt, "createdAt");
    }

    public static IdempotencyRecord claim(String key, String requestHash, Instant createdAt) {
        return new IdempotencyRecord(key, requestHash, createdAt);
    }

    public void complete(int statusCode, String responseBody) {
        if (this.statusCode != null || this.responseBody != null) {
            throw new IllegalStateException("idempotency response is already complete");
        }
        this.statusCode = statusCode;
        this.responseBody = Objects.requireNonNull(responseBody, "responseBody");
    }

    public String getKey() {
        return key;
    }

    public String getRequestHash() {
        return requestHash;
    }

    public Integer getStatusCode() {
        return statusCode;
    }

    public String getResponseBody() {
        return responseBody;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
