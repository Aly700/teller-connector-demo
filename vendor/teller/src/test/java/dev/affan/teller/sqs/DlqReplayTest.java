package dev.affan.teller.sqs;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.affan.teller.config.AwsProperties;
import dev.affan.teller.domain.AuditEventType;
import dev.affan.teller.domain.AuditRecord;
import dev.affan.teller.domain.AuditRecordRepository;
import dev.affan.teller.domain.AuditService;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.DeleteMessageRequest;
import software.amazon.awssdk.services.sqs.model.DeleteMessageResponse;
import software.amazon.awssdk.services.sqs.model.Message;
import software.amazon.awssdk.services.sqs.model.ReceiveMessageRequest;
import software.amazon.awssdk.services.sqs.model.ReceiveMessageResponse;
import software.amazon.awssdk.services.sqs.model.SendMessageRequest;
import software.amazon.awssdk.services.sqs.model.SendMessageResponse;
import tools.jackson.databind.ObjectMapper;

class DlqReplayTest {

    private static final Instant NOW = Instant.parse("2026-08-29T12:00:00Z");
    private final ApprovalMessageCodec codec = new ApprovalMessageCodec(new ObjectMapper());

    @Test
    void sendsAuditsThenDeletesEachDlqMessage() {
        ApprovalMessage logicalMessage = approvalMessage();
        List<String> order = new ArrayList<>();
        AtomicReference<ReceiveMessageRequest> receive = new AtomicReference<>();
        List<SendMessageRequest> sends = new ArrayList<>();
        List<DeleteMessageRequest> deletes = new ArrayList<>();
        SqsClient sqsClient = sqsClient(order, codec.encode(logicalMessage), receive, sends, deletes);
        AtomicReference<AuditRecord> auditRecord = new AtomicReference<>();
        AuditService audit = auditService(order, auditRecord, false);
        DlqReplayService replay = new DlqReplayService(sqsClient, properties(), audit);

        int replayed = replay.replay(5);

        assertThat(replayed).isEqualTo(1);
        assertThat(order).containsExactly("receive", "send", "audit", "delete");
        assertThat(receive.get().queueUrl()).isEqualTo("https://sqs.test/approvals-dlq");
        assertThat(receive.get().maxNumberOfMessages()).isEqualTo(5);
        assertThat(sends).singleElement().satisfies(request -> {
            assertThat(request.queueUrl()).isEqualTo("https://sqs.test/approvals");
            assertThat(request.messageBody()).isEqualTo(codec.encode(logicalMessage));
        });
        assertThat(deletes).singleElement().satisfies(request -> {
            assertThat(request.queueUrl()).isEqualTo("https://sqs.test/approvals-dlq");
            assertThat(request.receiptHandle()).isEqualTo("receipt-1");
        });
        UUID replayId = UUID.nameUUIDFromBytes("sqs-dlq:message-1".getBytes(StandardCharsets.UTF_8));
        assertThat(auditRecord.get().getId()).isEqualTo(replayId);
        assertThat(auditRecord.get().getEventType()).isEqualTo(AuditEventType.DLQ_REPLAYED);
        assertThat(auditRecord.get().getAggregateType()).isEqualTo("DLQ_REPLAY");
        assertThat(auditRecord.get().getAggregateId()).isEqualTo(replayId);
        assertThat(new ObjectMapper().readTree(auditRecord.get().getDetails()).get("messageId").asString())
                .isEqualTo("message-1");
    }

    @Test
    void leavesTheDlqSourceMessageWhenAuditingFails() {
        List<String> order = new ArrayList<>();
        List<SendMessageRequest> sends = new ArrayList<>();
        List<DeleteMessageRequest> deletes = new ArrayList<>();
        SqsClient sqsClient = sqsClient(
                order, codec.encode(approvalMessage()), new AtomicReference<>(), sends, deletes);
        DlqReplayService replay = new DlqReplayService(
                sqsClient, properties(), auditService(order, new AtomicReference<>(), true));

        assertThatThrownBy(() -> replay.replay(5))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("audit unavailable");

        assertThat(order).containsExactly("receive", "send", "audit");
        assertThat(sends).hasSize(1);
        assertThat(deletes).isEmpty();
    }

    private static AwsProperties properties() {
        AwsProperties properties = new AwsProperties();
        properties.getSqs().setQueueUrl("https://sqs.test/approvals");
        properties.getSqs().setDlqUrl("https://sqs.test/approvals-dlq");
        return properties;
    }

    private static ApprovalMessage approvalMessage() {
        return new ApprovalMessage(
                UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), NOW.plusSeconds(1800));
    }

    private static AuditService auditService(
            List<String> order,
            AtomicReference<AuditRecord> saved,
            boolean failOnSave) {
        AuditRecordRepository repository = (AuditRecordRepository) Proxy.newProxyInstance(
                AuditRecordRepository.class.getClassLoader(),
                new Class<?>[] {AuditRecordRepository.class},
                (proxy, method, arguments) -> switch (method.getName()) {
                    case "findAuditRecordById" -> Optional.empty();
                    case "storeAuditRecord" -> {
                        order.add("audit");
                        if (failOnSave) {
                            throw new IllegalStateException("audit unavailable");
                        }
                        AuditRecord record = (AuditRecord) arguments[0];
                        saved.set(record);
                        yield record;
                    }
                    default -> throw new UnsupportedOperationException(method.getName());
                });
        return new AuditService(
                repository,
                new ObjectMapper(),
                Clock.fixed(NOW, ZoneOffset.UTC));
    }

    private static SqsClient sqsClient(
            List<String> order,
            String body,
            AtomicReference<ReceiveMessageRequest> receive,
            List<SendMessageRequest> sends,
            List<DeleteMessageRequest> deletes) {
        return (SqsClient) Proxy.newProxyInstance(
                SqsClient.class.getClassLoader(),
                new Class<?>[] {SqsClient.class},
                (proxy, method, arguments) -> switch (method.getName()) {
                    case "receiveMessage" -> {
                        order.add("receive");
                        receive.set((ReceiveMessageRequest) arguments[0]);
                        yield ReceiveMessageResponse.builder()
                                .messages(Message.builder()
                                        .messageId("message-1")
                                        .receiptHandle("receipt-1")
                                        .body(body)
                                        .build())
                                .build();
                    }
                    case "sendMessage" -> {
                        order.add("send");
                        sends.add((SendMessageRequest) arguments[0]);
                        yield SendMessageResponse.builder().messageId("new-message-1").build();
                    }
                    case "deleteMessage" -> {
                        order.add("delete");
                        deletes.add((DeleteMessageRequest) arguments[0]);
                        yield DeleteMessageResponse.builder().build();
                    }
                    case "serviceName" -> "sqs";
                    case "close" -> null;
                    default -> throw new UnsupportedOperationException(method.getName());
                });
    }
}
