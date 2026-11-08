package dev.affan.teller.export;

import dev.affan.teller.domain.Entry;
import java.time.Instant;
import java.util.List;

@FunctionalInterface
public interface EntryRecordSource {
    List<Entry> find(Instant from, Instant to);
}
