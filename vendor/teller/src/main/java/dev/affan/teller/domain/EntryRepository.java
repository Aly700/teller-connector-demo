package dev.affan.teller.domain;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface EntryRepository extends JpaRepository<Entry, UUID>, EntryStore {
    List<Entry> findByTransferIdOrderByCreatedAtAscIdAsc(UUID transferId);

    List<Entry> findByCreatedAtGreaterThanEqualAndCreatedAtLessThanOrderByCreatedAtAscIdAsc(
            java.time.Instant from,
            java.time.Instant to);

    @Override
    default List<Entry> storeEntries(List<Entry> entries) {
        return saveAll(entries);
    }

    @Override
    default List<Entry> findEntriesByTransferId(UUID transferId) {
        return findByTransferIdOrderByCreatedAtAscIdAsc(transferId);
    }

    @Override
    default List<Entry> findEntries(java.time.Instant from, java.time.Instant to) {
        return findByCreatedAtGreaterThanEqualAndCreatedAtLessThanOrderByCreatedAtAscIdAsc(from, to);
    }

    @Override
    default List<Entry> findAllEntries() {
        return findAll(org.springframework.data.domain.Sort.by("createdAt").ascending().and(
                org.springframework.data.domain.Sort.by("id").ascending()));
    }
}
