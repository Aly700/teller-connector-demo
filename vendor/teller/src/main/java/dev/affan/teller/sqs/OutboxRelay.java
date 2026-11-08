package dev.affan.teller.sqs;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import java.time.Clock;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
@ConditionalOnProperty(name = "teller.aws.enabled", havingValue = "true")
public class OutboxRelay {

    private static final Logger LOGGER = LoggerFactory.getLogger(OutboxRelay.class);
    private static final int BATCH_SIZE = 50;

    private final OutboxStore outbox;
    private final ApprovalQueuePublisher publisher;
    private final ApprovalMessageCodec codec;
    private final Counter sentCounter;
    private final Counter failedCounter;
    private final Clock clock;

    public OutboxRelay(
            OutboxStore outbox,
            ApprovalQueuePublisher publisher,
            ApprovalMessageCodec codec,
            MeterRegistry meterRegistry,
            Clock clock) {
        this.outbox = outbox;
        this.publisher = publisher;
        this.codec = codec;
        this.sentCounter = meterRegistry.counter("teller.outbox.sent");
        this.failedCounter = meterRegistry.counter("teller.outbox.failed");
        this.clock = clock;
    }

    @Scheduled(
            fixedDelayString = "${teller.outbox.relay-interval:PT1S}",
            initialDelayString = "${teller.outbox.relay-initial-delay:PT1S}")
    @Transactional
    public int relayOnce() {
        List<OutboxMessage> batch = outbox.lockPendingBatch(BATCH_SIZE);
        int sent = 0;
        for (OutboxMessage message : batch) {
            try {
                publisher.publish(codec.decode(message.getPayload()));
                message.markSent(clock.instant());
                sentCounter.increment();
                sent++;
            } catch (RuntimeException exception) {
                String error = exception.getMessage() == null
                        ? exception.getClass().getSimpleName()
                        : exception.getMessage();
                message.markFailed(error);
                failedCounter.increment();
                LOGGER.warn(
                        "event=outbox_publish_failed outbox_id={} error_type={}",
                        message.getId(),
                        exception.getClass().getSimpleName());
            }
        }
        return sent;
    }
}
