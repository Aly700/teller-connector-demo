package dev.affan.teller.domain;

import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface IdempotencyRecordRepository extends JpaRepository<IdempotencyRecord, String> {

    @Modifying
    @Query(value = """
            INSERT INTO idempotency_records (key, request_hash, created_at)
            VALUES (:key, :requestHash, :createdAt)
            ON CONFLICT (key) DO NOTHING
            """, nativeQuery = true)
    int insertClaim(
            @Param("key") String key,
            @Param("requestHash") String requestHash,
            @Param("createdAt") Instant createdAt);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT record FROM IdempotencyRecord record WHERE record.key = :key")
    Optional<IdempotencyRecord> findLockedByKey(@Param("key") String key);

    @Modifying
    @Query("DELETE FROM IdempotencyRecord record WHERE record.key = :key AND record.createdAt < :cutoff")
    int deleteExpiredKey(@Param("key") String key, @Param("cutoff") Instant cutoff);

    @Modifying
    @Query("DELETE FROM IdempotencyRecord record WHERE record.createdAt < :cutoff")
    int deleteExpired(@Param("cutoff") Instant cutoff);
}
