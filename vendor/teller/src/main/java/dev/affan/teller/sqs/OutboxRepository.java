package dev.affan.teller.sqs;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface OutboxRepository extends JpaRepository<OutboxMessage, UUID>, OutboxStore {

    @Override
    default OutboxMessage storeOutboxMessage(OutboxMessage message) {
        return save(message);
    }

    @Query(value = """
            SELECT *
            FROM outbox_messages
            WHERE sent_at IS NULL
            ORDER BY created_at, id
            LIMIT :batchSize
            FOR UPDATE SKIP LOCKED
            """, nativeQuery = true)
    List<OutboxMessage> lockPendingBatch(@Param("batchSize") int batchSize);
}
