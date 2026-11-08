package dev.affan.teller.sqs;

@FunctionalInterface
public interface ApprovalMessageProcessor {

    void process(ApprovalMessage message);
}
