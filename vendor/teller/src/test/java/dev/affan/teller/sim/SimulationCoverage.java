package dev.affan.teller.sim;

import dev.affan.teller.domain.Transfer;
import dev.affan.teller.domain.TransferState;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.EnumMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import tools.jackson.databind.ObjectMapper;

final class SimulationCoverage {

    private long seeds;
    private long steps;
    private long transfers;
    private final Map<TransferState, Long> terminalStates = new EnumMap<>(TransferState.class);
    private final Map<String, Long> faults = new LinkedHashMap<>();

    void include(Simulator simulator, InMemoryStores stores, FaultInjectingBus bus) {
        seeds++;
        steps = Math.addExact(steps, simulator.completedSteps());
        for (Transfer transfer : stores.transfers()) {
            transfers++;
            terminalStates.merge(transfer.getState(), 1L, Math::addExact);
        }
        bus.faultCounts().forEach((kind, count) -> faults.merge(kind, count, Math::addExact));
    }

    String write(ObjectMapper objectMapper, Duration elapsed) {
        Map<String, Object> report = new LinkedHashMap<>();
        report.put("seeds", seeds);
        report.put("elapsedMillis", elapsed.toMillis());
        report.put("steps", steps);
        report.put("transfers", transfers);
        Map<String, Long> states = new LinkedHashMap<>();
        for (TransferState state : TransferState.values()) {
            if (state == TransferState.POSTED
                    || state == TransferState.REVERSED
                    || state == TransferState.DENIED) {
                states.put(state.name(), terminalStates.getOrDefault(state, 0L));
            }
        }
        report.put("terminalStates", states);
        report.put("faults", new java.util.TreeMap<>(faults));
        String json = objectMapper.writeValueAsString(report);
        Path target = Path.of("target", "sim-coverage.json");
        try {
            Files.createDirectories(target.getParent());
            Files.writeString(target, json + System.lineSeparator());
        } catch (IOException exception) {
            throw new IllegalStateException("failed to write " + target, exception);
        }
        return json;
    }

    void requireRequiredCoverage(int seedsRun) {
        if (seedsRun < 200) {
            return;
        }
        for (TransferState state : List.of(
                TransferState.DENIED,
                TransferState.POSTED,
                TransferState.REVERSED)) {
            require(terminalStates.getOrDefault(state, 0L) > 0, "terminal state was not covered: " + state);
        }
        for (String fault : List.of(
                "crash-before-commit",
                "crash-after-commit",
                "duplicate",
                "reorder",
                "delay",
                "drop-then-redeliver",
                "visibility-redelivery")) {
            require(faults.getOrDefault(fault, 0L) > 0, "fault was not covered: " + fault);
        }
    }

    private static void require(boolean condition, String message) {
        if (!condition) {
            throw new AssertionError(message);
        }
    }
}
