package dev.affan.teller.sqs;

import dev.affan.teller.config.AwsProperties;
import dev.affan.teller.domain.AuditEventType;
import dev.affan.teller.domain.AuditService;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.DeleteMessageRequest;
import software.amazon.awssdk.services.sqs.model.Message;
import software.amazon.awssdk.services.sqs.model.ReceiveMessageRequest;
import software.amazon.awssdk.services.sqs.model.SendMessageRequest;

@Service
@ConditionalOnProperty(name = "teller.aws.enabled", havingValue = "true")
public class DlqReplayService {

    private final SqsClient sqsClient;
    private final AuditService auditService;
    private final String queueUrl;
    private final String dlqUrl;

    public DlqReplayService(
            SqsClient sqsClient,
            AwsProperties properties,
            AuditService auditService) {
        this.sqsClient = sqsClient;
        this.auditService = auditService;
        this.queueUrl = properties.getSqs().getQueueUrl();
        this.dlqUrl = properties.getSqs().getDlqUrl();
    }

    public int replay(int limit) {
        if (limit < 1 || limit > 10) {
            throw new IllegalArgumentException("limit must be between 1 and 10");
        }
        if (!StringUtils.hasText(queueUrl) || !StringUtils.hasText(dlqUrl)) {
            throw new IllegalStateException("main queue URL and DLQ URL must be configured");
        }
        int replayed = 0;
        for (Message message : sqsClient.receiveMessage(ReceiveMessageRequest.builder()
                .queueUrl(dlqUrl)
                .waitTimeSeconds(0)
                .maxNumberOfMessages(limit)
                .build()).messages()) {
            sqsClient.sendMessage(SendMessageRequest.builder()
                    .queueUrl(queueUrl)
                    .messageBody(message.body())
                    .build());
            UUID replayId = replayId(message);
            auditService.appendOnce(
                    replayId,
                    AuditEventType.DLQ_REPLAYED,
                    "DLQ_REPLAY",
                    replayId,
                    Map.of(
                            "messageId", message.messageId(),
                            "replayId", replayId));
            sqsClient.deleteMessage(DeleteMessageRequest.builder()
                    .queueUrl(dlqUrl)
                    .receiptHandle(message.receiptHandle())
                    .build());
            replayed++;
        }
        return replayed;
    }

    private UUID replayId(Message message) {
        return UUID.nameUUIDFromBytes(
                ("sqs-dlq:" + message.messageId()).getBytes(StandardCharsets.UTF_8));
    }
}
