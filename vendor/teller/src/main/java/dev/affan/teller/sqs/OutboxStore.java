package dev.affan.teller.sqs;

import java.util.List;

public interface OutboxStore {

    OutboxMessage storeOutboxMessage(OutboxMessage message);

    List<OutboxMessage> lockPendingBatch(int batchSize);
}
