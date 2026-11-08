package dev.affan.teller.domain;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public interface EntryStore {

    List<Entry> storeEntries(List<Entry> entries);

    List<Entry> findEntriesByTransferId(UUID transferId);

    List<Entry> findEntries(Instant from, Instant to);

    List<Entry> findAllEntries();
}
