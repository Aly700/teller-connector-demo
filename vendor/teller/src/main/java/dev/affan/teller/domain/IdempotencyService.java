package dev.affan.teller.domain;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Map;
import java.util.Objects;
import java.util.function.Supplier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;

@Service
public class IdempotencyService {

    private static final int REPLAY_STATUS = 200;

    private final IdempotencyStore records;
    private final Clock clock;
    private final Duration ttl;

    public IdempotencyService(
            IdempotencyStore records,
            Clock clock,
            @Value("${teller.idempotency.ttl:PT24H}") Duration ttl) {
        if (ttl.isZero() || ttl.isNegative()) {
            throw new IllegalArgumentException("teller.idempotency.ttl must be positive");
        }
        this.records = records;
        this.clock = clock;
        this.ttl = ttl;
    }

    @Transactional
    public StoredResponse execute(
            String key,
            String requestHash,
            Supplier<StoredResponse> operation) {
        Objects.requireNonNull(key, "key");
        Objects.requireNonNull(requestHash, "requestHash");
        Objects.requireNonNull(operation, "operation");
        Instant now = clock.instant();
        records.deleteExpiredKey(key, now.minus(ttl));
        boolean claimed = records.insertClaim(key, requestHash, now) == 1;
        IdempotencyRecord record = records.findLockedByKey(key)
                .orElseThrow(() -> new IllegalStateException("idempotency claim was not persisted"));
        if (!record.getRequestHash().equals(requestHash)) {
            throw new ConflictException("Idempotency-Key was already used with a different request body.");
        }
        if (!claimed) {
            if (record.getStatusCode() == null || record.getResponseBody() == null) {
                throw new IllegalStateException("idempotency response is incomplete");
            }
            return new StoredResponse(REPLAY_STATUS, record.getResponseBody());
        }

        StoredResponse response = Objects.requireNonNull(operation.get(), "operation response");
        record.complete(response.statusCode(), response.responseBody());
        records.flushAndRefresh(record);
        return new StoredResponse(response.statusCode(), record.getResponseBody());
    }

    public String requestHash(JsonNode body) {
        Objects.requireNonNull(body, "body");
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(
                    canonicalJson(body).getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }

    @Scheduled(fixedDelayString = "${teller.idempotency.sweep-interval:PT1H}")
    @Transactional
    public int sweepExpired() {
        return records.deleteExpired(clock.instant().minus(ttl));
    }

    private static String canonicalJson(JsonNode node) {
        if (node.isObject()) {
            StringBuilder value = new StringBuilder("{");
            boolean first = true;
            for (Map.Entry<String, JsonNode> property : node.properties().stream()
                    .sorted(Map.Entry.comparingByKey())
                    .toList()) {
                if (!first) {
                    value.append(',');
                }
                value.append(quote(property.getKey()))
                        .append(':')
                        .append(canonicalJson(property.getValue()));
                first = false;
            }
            return value.append('}').toString();
        }
        if (node.isArray()) {
            StringBuilder value = new StringBuilder("[");
            boolean first = true;
            for (JsonNode element : node) {
                if (!first) {
                    value.append(',');
                }
                value.append(canonicalJson(element));
                first = false;
            }
            return value.append(']').toString();
        }
        if (node.isNumber()) {
            return node.decimalValue().stripTrailingZeros().toPlainString();
        }
        return node.toString();
    }

    private static String quote(String value) {
        StringBuilder quoted = new StringBuilder("\"");
        value.codePoints().forEach(codePoint -> {
            switch (codePoint) {
                case '"' -> quoted.append("\\\"");
                case '\\' -> quoted.append("\\\\");
                case '\b' -> quoted.append("\\b");
                case '\f' -> quoted.append("\\f");
                case '\n' -> quoted.append("\\n");
                case '\r' -> quoted.append("\\r");
                case '\t' -> quoted.append("\\t");
                default -> {
                    if (codePoint < 0x20) {
                        quoted.append("\\u%04x".formatted(codePoint));
                    } else {
                        quoted.appendCodePoint(codePoint);
                    }
                }
            }
        });
        return quoted.append('"').toString();
    }

    public record StoredResponse(int statusCode, String responseBody) {

        public StoredResponse {
            if (statusCode < 100 || statusCode > 599) {
                throw new IllegalArgumentException("statusCode must be a valid HTTP status");
            }
            Objects.requireNonNull(responseBody, "responseBody");
        }
    }
}
