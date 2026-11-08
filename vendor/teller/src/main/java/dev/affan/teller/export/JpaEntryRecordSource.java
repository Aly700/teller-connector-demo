package dev.affan.teller.export;

import dev.affan.teller.domain.Entry;
import dev.affan.teller.domain.EntryStore;
import java.time.Instant;
import java.util.List;
import org.springframework.stereotype.Component;

@Component
public class JpaEntryRecordSource implements EntryRecordSource {

    private final EntryStore entries;

    public JpaEntryRecordSource(EntryStore entries) {
        this.entries = entries;
    }

    @Override
    public List<Entry> find(Instant from, Instant to) {
        return entries.findEntries(from, to);
    }
}
