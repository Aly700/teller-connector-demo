package dev.affan.teller.domain;

import java.time.Instant;
import java.util.Optional;

public interface IdempotencyStore {

    int insertClaim(String key, String requestHash, Instant createdAt);

    Optional<IdempotencyRecord> findLockedByKey(String key);

    int deleteExpiredKey(String key, Instant cutoff);

    int deleteExpired(Instant cutoff);

    void flushAndRefresh(IdempotencyRecord record);
}
