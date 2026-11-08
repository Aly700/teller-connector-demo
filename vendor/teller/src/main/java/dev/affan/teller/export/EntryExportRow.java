package dev.affan.teller.export;

import dev.affan.teller.domain.Entry;
import dev.affan.teller.domain.EntryDirection;
import java.time.Instant;
import java.util.UUID;

public record EntryExportRow(
        UUID id,
        UUID postingId,
        UUID transferId,
        UUID accountId,
        EntryDirection direction,
        long amountMinor,
        String currency,
        Instant createdAt) {

    public static EntryExportRow from(Entry entry) {
        return new EntryExportRow(
                entry.getId(),
                entry.getPostingId(),
                entry.getTransferId(),
                entry.getAccountId(),
                entry.getDirection(),
                entry.getAmountMinor(),
                entry.getCurrency(),
                entry.getCreatedAt());
    }
}
