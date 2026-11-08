package dev.affan.teller.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

@Entity
@Table(name = "policies")
public class Policy {

    @Id
    private UUID id;

    @Column(nullable = false, length = 160, updatable = false)
    private String name;

    @Column(nullable = false, updatable = false)
    private int version;

    @Column(nullable = false)
    private boolean active;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected Policy() {
    }

    private Policy(UUID id, String name, int version, Instant createdAt) {
        this.id = Objects.requireNonNull(id, "id");
        if (name == null || name.isBlank()) {
            throw new IllegalArgumentException("name must not be blank");
        }
        if (version < 1) {
            throw new IllegalArgumentException("version must be positive");
        }
        this.name = name.trim();
        this.version = version;
        this.active = true;
        this.createdAt = Objects.requireNonNull(createdAt, "createdAt");
    }

    public static Policy create(UUID id, String name, int version, Instant createdAt) {
        return new Policy(id, name, version, createdAt);
    }

    public void deactivate() {
        active = false;
    }

    public UUID getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public int getVersion() {
        return version;
    }

    public boolean isActive() {
        return active;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
