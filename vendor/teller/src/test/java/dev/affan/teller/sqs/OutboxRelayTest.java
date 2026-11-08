package dev.affan.teller.sqs;

import static org.assertj.core.api.Assertions.assertThat;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.lang.reflect.Proxy;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

class OutboxRelayTest {

    private static final Instant NOW = Instant.parse("2026-08-29T12:00:00Z");
    private final ApprovalMessageCodec codec = new ApprovalMessageCodec(new ObjectMapper());

    @Test
    void publishesAndMarksPendingRowsSent() {
        ApprovalMessage approval = approvalMessage();
        OutboxMessage row = pending(approval);
        AtomicReference<ApprovalMessage> published = new AtomicReference<>();
        SimpleMeterRegistry metrics = new SimpleMeterRegistry();
        OutboxRelay relay = relay(List.of(row), published::set, metrics);

        int sent = relay.relayOnce();

        assertThat(sent).isEqualTo(1);
        assertThat(published).hasValue(approval);
        assertThat(row.getSentAt()).isEqualTo(NOW);
        assertThat(row.getAttempts()).isEqualTo(1);
        assertThat(row.getLastError()).isNull();
        assertThat(metrics.counter("teller.outbox.sent").count()).isEqualTo(1.0);
    }

    @Test
    void recordsFailureAndLeavesRowPendingForRetry() {
        ApprovalMessage approval = approvalMessage();
        OutboxMessage row = pending(approval);
        SimpleMeterRegistry metrics = new SimpleMeterRegistry();
        OutboxRelay relay = relay(List.of(row), ignored -> {
            throw new IllegalStateException("SQS unavailable");
        }, metrics);

        int sent = relay.relayOnce();

        assertThat(sent).isZero();
        assertThat(row.getSentAt()).isNull();
        assertThat(row.getAttempts()).isEqualTo(1);
        assertThat(row.getLastError()).isEqualTo("SQS unavailable");
        assertThat(metrics.counter("teller.outbox.failed").count()).isEqualTo(1.0);
    }

    private OutboxRelay relay(
            List<OutboxMessage> pending,
            ApprovalQueuePublisher publisher,
            SimpleMeterRegistry metrics) {
        OutboxRepository repository = (OutboxRepository) Proxy.newProxyInstance(
                OutboxRepository.class.getClassLoader(),
                new Class<?>[] {OutboxRepository.class},
                (proxy, method, arguments) -> {
                    if (method.getName().equals("lockPendingBatch")) {
                        assertThat(arguments[0]).isEqualTo(50);
                        return pending;
                    }
                    throw new UnsupportedOperationException(method.getName());
                });
        return new OutboxRelay(
                repository,
                publisher,
                codec,
                metrics,
                Clock.fixed(NOW, ZoneOffset.UTC));
    }

    private OutboxMessage pending(ApprovalMessage approval) {
        return OutboxMessage.pending(
                approval.messageId(),
                "APPROVAL",
                UUID.randomUUID(),
                codec.encode(approval),
                NOW.minusSeconds(10));
    }

    private static ApprovalMessage approvalMessage() {
        return new ApprovalMessage(
                UUID.randomUUID(),
                UUID.randomUUID(),
                UUID.randomUUID(),
                NOW.plusSeconds(1800));
    }
}
