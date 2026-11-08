package dev.affan.teller.sqs;

import dev.affan.teller.config.AwsProperties;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.SendMessageRequest;

@Component
@ConditionalOnProperty(name = "teller.aws.enabled", havingValue = "true")
public class AwsApprovalQueuePublisher implements ApprovalQueuePublisher {

    private final SqsClient sqsClient;
    private final ApprovalMessageCodec codec;
    private final String queueUrl;

    public AwsApprovalQueuePublisher(
            SqsClient sqsClient,
            ApprovalMessageCodec codec,
            AwsProperties properties) {
        this.sqsClient = sqsClient;
        this.codec = codec;
        this.queueUrl = properties.getSqs().getQueueUrl();
        if (!StringUtils.hasText(queueUrl)) {
            throw new IllegalStateException("teller.aws.sqs.queue-url must be configured when AWS is enabled");
        }
    }

    @Override
    public void publish(ApprovalMessage message) {
        sqsClient.sendMessage(SendMessageRequest.builder()
                .queueUrl(queueUrl)
                .messageBody(codec.encode(message))
                .build());
    }
}
