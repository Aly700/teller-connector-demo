package dev.affan.teller.sqs;

import static org.assertj.core.api.Assertions.assertThat;

import dev.affan.teller.config.AwsProperties;
import java.lang.reflect.Proxy;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.SendMessageRequest;
import software.amazon.awssdk.services.sqs.model.SendMessageResponse;
import tools.jackson.databind.ObjectMapper;

class AwsApprovalQueuePublisherTest {

    @Test
    void sendsEncodedApprovalToTheConfiguredQueueUrl() {
        AtomicReference<SendMessageRequest> sent = new AtomicReference<>();
        SqsClient sqsClient = (SqsClient) Proxy.newProxyInstance(
                SqsClient.class.getClassLoader(),
                new Class<?>[] {SqsClient.class},
                (proxy, method, arguments) -> switch (method.getName()) {
                    case "sendMessage" -> {
                        sent.set((SendMessageRequest) arguments[0]);
                        yield SendMessageResponse.builder().messageId("message-1").build();
                    }
                    case "serviceName" -> "sqs";
                    case "close" -> null;
                    default -> throw new UnsupportedOperationException(method.getName());
                });
        AwsProperties properties = new AwsProperties();
        properties.getSqs().setQueueUrl("https://sqs.test/approvals");
        ApprovalMessageCodec codec = new ApprovalMessageCodec(new ObjectMapper());
        AwsApprovalQueuePublisher publisher = new AwsApprovalQueuePublisher(sqsClient, codec, properties);
        ApprovalMessage message = new ApprovalMessage(
                UUID.randomUUID(),
                UUID.randomUUID(),
                UUID.randomUUID(),
                Instant.parse("2026-08-28T13:00:00Z"));

        publisher.publish(message);

        assertThat(sent.get().queueUrl()).isEqualTo("https://sqs.test/approvals");
        assertThat(codec.decode(sent.get().messageBody())).isEqualTo(message);
    }
}
