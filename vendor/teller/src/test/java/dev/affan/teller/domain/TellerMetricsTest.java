package dev.affan.teller.domain;

import static org.assertj.core.api.Assertions.assertThat;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class TellerMetricsTest {

    @Test
    void exposesTerminalTransferCountsAndActiveReservationCountAsGauges() {
        Transfer posted = transfer("posted", 4_000);
        posted.authorize();
        posted.post(Instant.parse("2026-08-29T12:01:00Z"));
        Transfer held = transfer("held", 6_000);
        held.hold(UUID.randomUUID());
        Transfer denied = transfer("denied", 12_000);
        denied.deny("POLICY_DENIED");
        MemoryTransfers transfers = new MemoryTransfers(List.of(posted, held, denied));
        SimpleMeterRegistry registry = new SimpleMeterRegistry();

        new TellerMetrics(registry, transfers);

        assertThat(registry.get("teller.transfers.terminal")
                .tag("state", "POSTED").gauge().value()).isEqualTo(1);
        assertThat(registry.get("teller.transfers.terminal")
                .tag("state", "DENIED").gauge().value()).isEqualTo(1);
        assertThat(registry.get("teller.transfers.terminal")
                .tag("state", "REVERSED").gauge().value()).isZero();
        assertThat(registry.get("teller.reservations.active").gauge().value()).isEqualTo(1);
    }

    private static Transfer transfer(String key, long amountMinor) {
        return Transfer.pending(
                UUID.randomUUID(), key, UUID.randomUUID(), UUID.randomUUID(),
                Money.of(amountMinor, "USD"), UUID.randomUUID(),
                Instant.parse("2026-08-29T12:00:00Z"));
    }

    private static final class MemoryTransfers implements TransferStore {
        private final List<Transfer> transfers;

        private MemoryTransfers(List<Transfer> transfers) {
            this.transfers = new ArrayList<>(transfers);
        }

        @Override public Transfer storeTransfer(Transfer transfer) { transfers.add(transfer); return transfer; }
        @Override public Optional<Transfer> findTransferById(UUID id) { return Optional.empty(); }
        @Override public Optional<Transfer> findTransferByApprovalId(UUID id) { return Optional.empty(); }
        @Override public Optional<Transfer> findLockedTransferById(UUID id) { return Optional.empty(); }
        @Override public Optional<Transfer> findLockedTransferByDecisionId(UUID id) { return Optional.empty(); }
        @Override public long countTransfers(UUID from, Instant since, TransferState excluded) { return 0; }
        @Override public List<Transfer> findAllTransfers() { return List.copyOf(transfers); }
    }
}
