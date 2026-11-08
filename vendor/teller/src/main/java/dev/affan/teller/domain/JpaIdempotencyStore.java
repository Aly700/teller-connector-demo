package dev.affan.teller.domain;

import jakarta.persistence.EntityManager;
import java.time.Instant;
import java.util.Optional;
import org.springframework.stereotype.Component;

@Component
public class JpaIdempotencyStore implements IdempotencyStore {

    private final IdempotencyRecordRepository records;
    private final EntityManager entityManager;

    public JpaIdempotencyStore(
            IdempotencyRecordRepository records,
            EntityManager entityManager) {
        this.records = records;
        this.entityManager = entityManager;
    }

    @Override
    public int insertClaim(String key, String requestHash, Instant createdAt) {
        return records.insertClaim(key, requestHash, createdAt);
    }

    @Override
    public Optional<IdempotencyRecord> findLockedByKey(String key) {
        return records.findLockedByKey(key);
    }

    @Override
    public int deleteExpiredKey(String key, Instant cutoff) {
        return records.deleteExpiredKey(key, cutoff);
    }

    @Override
    public int deleteExpired(Instant cutoff) {
        return records.deleteExpired(cutoff);
    }

    @Override
    public void flushAndRefresh(IdempotencyRecord record) {
        entityManager.flush();
        entityManager.refresh(record);
    }
}
