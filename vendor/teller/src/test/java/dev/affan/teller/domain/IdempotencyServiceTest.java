package dev.affan.teller.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

class IdempotencyServiceTest {

    @Test
    void replayUsesTheCompletedProductionRecordWithoutInvokingTheOperationAgain() {
        InMemoryIdempotencyStore store = new InMemoryIdempotencyStore();
        IdempotencyService service = new IdempotencyService(
                store,
                Clock.fixed(Instant.parse("2026-08-29T00:00:00Z"), ZoneOffset.UTC),
                Duration.ofHours(24));
        AtomicInteger invocations = new AtomicInteger();

        IdempotencyService.StoredResponse first = service.execute(
                "transfer-key",
                "request-hash",
                () -> {
                    invocations.incrementAndGet();
                    return new IdempotencyService.StoredResponse(201, "{\"id\":\"transfer-1\"}");
                });
        IdempotencyService.StoredResponse replay = service.execute(
                "transfer-key",
                "request-hash",
                () -> {
                    invocations.incrementAndGet();
                    throw new AssertionError("replay must not invoke the operation");
                });

        assertThat(first.statusCode()).isEqualTo(201);
        assertThat(replay.statusCode()).isEqualTo(200);
        assertThat(replay.responseBody()).isEqualTo(first.responseBody());
        assertThat(invocations).hasValue(1);
    }

    private static final class InMemoryIdempotencyStore implements IdempotencyStore {
        private final Map<String, IdempotencyRecord> records = new LinkedHashMap<>();

        @Override
        public int insertClaim(String key, String requestHash, Instant createdAt) {
            if (records.containsKey(key)) {
                return 0;
            }
            records.put(key, IdempotencyRecord.claim(key, requestHash, createdAt));
            return 1;
        }

        @Override
        public Optional<IdempotencyRecord> findLockedByKey(String key) {
            return Optional.ofNullable(records.get(key));
        }

        @Override
        public int deleteExpiredKey(String key, Instant cutoff) {
            IdempotencyRecord record = records.get(key);
            if (record != null && record.getCreatedAt().isBefore(cutoff)) {
                records.remove(key);
                return 1;
            }
            return 0;
        }

        @Override
        public int deleteExpired(Instant cutoff) {
            int before = records.size();
            records.values().removeIf(record -> record.getCreatedAt().isBefore(cutoff));
            return before - records.size();
        }

        @Override
        public void flushAndRefresh(IdempotencyRecord record) {
        }
    }
}
