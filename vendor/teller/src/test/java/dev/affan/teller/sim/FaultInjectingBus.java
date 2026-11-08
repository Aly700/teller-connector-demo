package dev.affan.teller.sim;

import dev.affan.teller.sqs.ApprovalMessage;
import dev.affan.teller.sqs.ApprovalMessageCodec;
import dev.affan.teller.sqs.ApprovalMessageProcessor;
import dev.affan.teller.sqs.ApprovalQueuePublisher;
import java.lang.reflect.Proxy;
import java.time.Duration;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.DeleteMessageRequest;
import software.amazon.awssdk.services.sqs.model.DeleteMessageResponse;
import software.amazon.awssdk.services.sqs.model.Message;
import software.amazon.awssdk.services.sqs.model.ReceiveMessageRequest;
import software.amazon.awssdk.services.sqs.model.ReceiveMessageResponse;

final class FaultInjectingBus implements ApprovalQueuePublisher {

    private static final Duration VISIBILITY_TIMEOUT = Duration.ofMillis(250);

    private final Simulator simulator;
    private final Trace trace;
    private final FaultProfile faults;
    private final ApprovalMessageCodec codec;
    private final Deque<Envelope> available = new ArrayDeque<>();
    private final Map<String, Envelope> inFlight = new LinkedHashMap<>();
    private final Map<UUID, Integer> publishAttempts = new LinkedHashMap<>();
    private final Map<UUID, Integer> effectCounts = new LinkedHashMap<>();
    private final Map<String, Long> faultCounts = new LinkedHashMap<>();
    private boolean faultsEnabled = true;
    private long transportSequence;
    private long receiptSequence;

    private FaultInjectingBus(
            Simulator simulator,
            Trace trace,
            FaultProfile faults,
            ApprovalMessageCodec codec) {
        this.simulator = simulator;
        this.trace = trace;
        this.faults = faults;
        this.codec = codec;
    }

    static FaultInjectingBus standard(
            Simulator simulator,
            Trace trace,
            ApprovalMessageCodec codec) {
        return new FaultInjectingBus(
                simulator,
                trace,
                new FaultProfile(0.35, 0.25, 0.30, 0.20, 0.05, 0.05),
                codec);
    }

    @Override
    public void publish(ApprovalMessage message) {
        publishAttempts.merge(message.messageId(), 1, Integer::sum);
        trace.record(simulator.instant(), "publish-attempt event=" + message.messageId());
        if (crashBeforeCommit("outbox-publish")) {
            throw new SimulatedCrash("crash before publish commit");
        }

        enqueueWithNetworkFaults(message, "primary");
        if (faultsEnabled && simulator.chance(faults.duplicateProbability())) {
            recordFault("duplicate");
            trace.record(simulator.instant(), "fault=duplicate event=" + message.messageId());
            enqueueWithNetworkFaults(message, "duplicate");
        }
        if (crashAfterCommit("outbox-publish")) {
            throw new SimulatedCrash("crash after publish commit");
        }
    }

    ApprovalMessageProcessor processor(ApprovalMessageProcessor delegate) {
        return message -> {
            if (crashBeforeCommit("consumer")) {
                throw new SimulatedCrash("crash before consumer commit");
            }
            delegate.process(message);
            effectCounts.merge(message.messageId(), 1, Integer::sum);
            trace.record(simulator.instant(), "consumer-effect event=" + message.messageId());
        };
    }

    SqsClient sqsClient() {
        return (SqsClient) Proxy.newProxyInstance(
                SqsClient.class.getClassLoader(),
                new Class<?>[] {SqsClient.class},
                (proxy, method, args) -> switch (method.getName()) {
                    case "receiveMessage" -> receive((ReceiveMessageRequest) args[0]);
                    case "deleteMessage" -> delete((DeleteMessageRequest) args[0]);
                    case "serviceName" -> "deterministic-sqs";
                    case "close" -> null;
                    case "toString" -> "FaultInjectingSqsClient";
                    default -> throw new UnsupportedOperationException("SqsClient." + method.getName());
                });
    }

    boolean crashBeforeCommit(String operation) {
        boolean crash = faultsEnabled && simulator.chance(faults.crashBeforeCommitProbability());
        if (crash) {
            recordFault("crash-before-commit");
            trace.record(simulator.instant(), "fault=crash-before-commit operation=" + operation);
        }
        return crash;
    }

    boolean crashAfterCommit(String operation) {
        boolean crash = faultsEnabled && simulator.chance(faults.crashAfterCommitProbability());
        if (crash) {
            recordFault("crash-after-commit");
            trace.record(simulator.instant(), "fault=crash-after-commit operation=" + operation);
        }
        return crash;
    }

    Map<UUID, Integer> effectCounts() {
        return Map.copyOf(effectCounts);
    }

    Map<UUID, Integer> publishAttempts() {
        return Map.copyOf(publishAttempts);
    }

    Map<String, Long> faultCounts() {
        return Map.copyOf(faultCounts);
    }

    int pendingMessages() {
        return available.size() + inFlight.size();
    }

    void recover() {
        faultsEnabled = false;
        trace.record(simulator.instant(), "fault-injection-disabled");
    }

    private void enqueueWithNetworkFaults(ApprovalMessage message, String kind) {
        Envelope envelope = new Envelope(
                "transport-" + simulator.seed() + "-" + transportSequence++,
                codec.encode(message));
        if (faultsEnabled && simulator.chance(faults.dropThenRedeliverProbability())) {
            recordFault("drop-then-redeliver");
            trace.record(simulator.instant(), "fault=drop-then-redeliver event=" + message.messageId());
            simulator.schedule(
                    Duration.ofMillis(100L + simulator.nextInt(400)),
                    "redeliver-dropped " + message.messageId(),
                    () -> deliver(envelope, kind));
            return;
        }
        Duration delay = faultsEnabled && simulator.chance(faults.delayProbability())
                ? Duration.ofMillis(1L + simulator.nextInt(300))
                : Duration.ZERO;
        if (!delay.isZero()) {
            recordFault("delay");
            trace.record(simulator.instant(), "fault=delay event=" + message.messageId() + " by=" + delay);
        }
        simulator.schedule(delay, "deliver-" + kind + " " + message.messageId(), () -> deliver(envelope, kind));
    }

    private void deliver(Envelope envelope, String kind) {
        boolean reordered = faultsEnabled && simulator.chance(faults.reorderProbability());
        if (reordered) {
            recordFault("reorder");
            available.addFirst(envelope);
        } else {
            available.addLast(envelope);
        }
        trace.record(
                simulator.instant(),
                "queue-delivery transport=" + envelope.transportId() + " kind=" + kind
                        + (reordered ? " reordered" : ""));
    }

    private ReceiveMessageResponse receive(ReceiveMessageRequest request) {
        int limit = Math.min(request.maxNumberOfMessages(), available.size());
        List<Message> messages = new ArrayList<>(limit);
        for (int index = 0; index < limit; index++) {
            Envelope envelope = available.removeFirst();
            String receipt = "receipt-" + receiptSequence++;
            inFlight.put(receipt, envelope);
            messages.add(Message.builder()
                    .messageId(envelope.transportId())
                    .receiptHandle(receipt)
                    .body(envelope.body())
                    .build());
            simulator.schedule(
                    VISIBILITY_TIMEOUT,
                    "visibility-timeout " + envelope.transportId(),
                    () -> redeliverIfUnacknowledged(receipt));
        }
        return ReceiveMessageResponse.builder().messages(messages).build();
    }

    private DeleteMessageResponse delete(DeleteMessageRequest request) {
        Envelope envelope = inFlight.get(request.receiptHandle());
        if (envelope == null) {
            return DeleteMessageResponse.builder().build();
        }
        if (crashAfterCommit("consumer")) {
            throw new SimulatedCrash("crash after consumer commit before delete");
        }
        inFlight.remove(request.receiptHandle());
        trace.record(simulator.instant(), "queue-delete transport=" + envelope.transportId());
        return DeleteMessageResponse.builder().build();
    }

    private void redeliverIfUnacknowledged(String receipt) {
        Envelope envelope = inFlight.remove(receipt);
        if (envelope != null) {
            recordFault("visibility-redelivery");
            available.addLast(envelope);
            trace.record(simulator.instant(), "queue-redelivery transport=" + envelope.transportId());
        }
    }

    private void recordFault(String kind) {
        faultCounts.merge(kind, 1L, Long::sum);
    }

    record FaultProfile(
            double duplicateProbability,
            double reorderProbability,
            double delayProbability,
            double dropThenRedeliverProbability,
            double crashBeforeCommitProbability,
            double crashAfterCommitProbability) {
    }

    private record Envelope(String transportId, String body) {
    }

    static final class SimulatedCrash extends RuntimeException {

        SimulatedCrash(String message) {
            super(message);
        }
    }
}
