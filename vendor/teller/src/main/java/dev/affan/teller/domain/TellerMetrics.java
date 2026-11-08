package dev.affan.teller.domain;

import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.stereotype.Component;

@Component
public class TellerMetrics {

    public TellerMetrics(MeterRegistry registry, TransferStore transfers) {
        for (TransferState state : new TransferState[] {
                TransferState.DENIED,
                TransferState.POSTED,
                TransferState.REVERSED
        }) {
            Gauge.builder(
                            "teller.transfers.terminal",
                            transfers,
                            store -> store.countTransfersByState(state))
                    .description("Current transfers by terminal state")
                    .baseUnit("transfers")
                    .tag("state", state.name())
                    .register(registry);
        }
        Gauge.builder(
                        "teller.reservations.active",
                        transfers,
                        store -> store.countTransfersByState(TransferState.HELD))
                .description("Current held transfer reservations")
                .baseUnit("reservations")
                .register(registry);
    }
}
