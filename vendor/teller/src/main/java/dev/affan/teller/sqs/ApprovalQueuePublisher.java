package dev.affan.teller.sqs;

public interface ApprovalQueuePublisher {
    void publish(ApprovalMessage message);
}
