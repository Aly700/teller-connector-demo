package dev.affan.teller.sqs;

import dev.affan.teller.config.AwsProperties;
import java.sql.Timestamp;
import java.time.Clock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.StringUtils;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.DeleteMessageRequest;
import software.amazon.awssdk.services.sqs.model.Message;
import software.amazon.awssdk.services.sqs.model.ReceiveMessageRequest;
import software.amazon.awssdk.services.sqs.model.ReceiveMessageResponse;

@Component
@ConditionalOnProperty(
        name = {"teller.aws.enabled", "teller.aws.sqs.worker-enabled"},
        havingValue = "true")
public class ApprovalQueueWorker {

    private static final Logger LOGGER = LoggerFactory.getLogger(ApprovalQueueWorker.class);

    private final SqsClient sqsClient;
    private final ApprovalMessageCodec codec;
    private final MessageHandler messageHandler;
    private final String queueUrl;
    private final int waitTimeSeconds;
    private final int maxMessages;

    @Autowired
    public ApprovalQueueWorker(
            SqsClient sqsClient,
            ApprovalMessageCodec codec,
            ApprovalMessageProcessor processor,
            JdbcTemplate jdbcTemplate,
            PlatformTransactionManager transactionManager,
            Clock clock,
            AwsProperties properties) {
        this(
                sqsClient,
                codec,
                transactionalHandler(processor, jdbcTemplate, transactionManager, clock),
                properties);
    }

    ApprovalQueueWorker(
            SqsClient sqsClient,
            ApprovalMessageCodec codec,
            ApprovalMessageProcessor processor,
            AwsProperties properties) {
        this(sqsClient, codec, (MessageHandler) processor::process, properties);
    }

    private ApprovalQueueWorker(
            SqsClient sqsClient,
            ApprovalMessageCodec codec,
            MessageHandler messageHandler,
            AwsProperties properties) {
        this.sqsClient = sqsClient;
        this.codec = codec;
        this.messageHandler = messageHandler;
        this.queueUrl = properties.getSqs().getQueueUrl();
        this.waitTimeSeconds = properties.getSqs().getWaitTimeSeconds();
        this.maxMessages = properties.getSqs().getMaxMessages();
        if (!StringUtils.hasText(queueUrl)) {
            throw new IllegalStateException("teller.aws.sqs.queue-url must be configured when AWS is enabled");
        }
        if (waitTimeSeconds < 0 || waitTimeSeconds > 20) {
            throw new IllegalStateException("teller.aws.sqs.wait-time-seconds must be between 0 and 20");
        }
        if (maxMessages < 1 || maxMessages > 10) {
            throw new IllegalStateException("teller.aws.sqs.max-messages must be between 1 and 10");
        }
    }

    @Scheduled(
            fixedDelayString = "${teller.aws.sqs.poll-interval:PT1S}",
            initialDelayString = "${teller.aws.sqs.worker-initial-delay:PT1S}")
    public int poll() {
        ReceiveMessageResponse response;
        try {
            response = sqsClient.receiveMessage(ReceiveMessageRequest.builder()
                    .queueUrl(queueUrl)
                    .waitTimeSeconds(waitTimeSeconds)
                    .maxNumberOfMessages(maxMessages)
                    .build());
        } catch (RuntimeException exception) {
            LOGGER.warn(
                    "event=approval_queue_receive_failed error_type={}",
                    exception.getClass().getSimpleName());
            return 0;
        }

        int processedCount = 0;
        for (Message message : response.messages()) {
            if (processAndDelete(message)) {
                processedCount++;
            }
        }
        return processedCount;
    }

    boolean processAndDelete(Message message) {
        try {
            messageHandler.process(codec.decode(message.body()));
            sqsClient.deleteMessage(DeleteMessageRequest.builder()
                    .queueUrl(queueUrl)
                    .receiptHandle(message.receiptHandle())
                    .build());
            return true;
        } catch (RuntimeException exception) {
            LOGGER.warn(
                    "event=approval_queue_message_failed message_id={} error_type={}",
                    message.messageId(),
                    exception.getClass().getSimpleName());
            return false;
        }
    }

    private static MessageHandler transactionalHandler(
            ApprovalMessageProcessor processor,
            JdbcTemplate jdbcTemplate,
            PlatformTransactionManager transactionManager,
            Clock clock) {
        TransactionTemplate transaction = new TransactionTemplate(transactionManager);
        return message -> transaction.executeWithoutResult(status -> {
            int inserted = jdbcTemplate.update(
                    """
                    INSERT INTO processed_messages (message_id, processed_at)
                    VALUES (?, ?)
                    ON CONFLICT (message_id) DO NOTHING
                    """,
                    message.messageId().toString(),
                    Timestamp.from(clock.instant()));
            if (inserted == 1) {
                processor.process(message);
            }
        });
    }

    @FunctionalInterface
    private interface MessageHandler {
        void process(ApprovalMessage message);
    }
}
