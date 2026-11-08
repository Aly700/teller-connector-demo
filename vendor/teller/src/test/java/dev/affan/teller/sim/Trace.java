package dev.affan.teller.sim;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

final class Trace {

    private static final int MAX_RENDERED_ENTRIES = 80;

    private final long seed;
    private final List<Entry> entries = new ArrayList<>();

    Trace(long seed) {
        this.seed = seed;
    }

    void record(Instant at, String event) {
        entries.add(new Entry(at, event));
    }

    AssertionError failure(Throwable cause) {
        return new AssertionError(
                "simulation failed; reproduce with -Dsim.seed=" + seed + System.lineSeparator()
                        + renderMinimal(),
                cause);
    }

    String renderMinimal() {
        List<Entry> relevant = entries.stream().filter(entry -> !isNoisyPoll(entry.event())).toList();
        int first = Math.max(0, relevant.size() - MAX_RENDERED_ENTRIES);
        StringBuilder rendered = new StringBuilder("minimal event trace");
        if (first > 0) {
            rendered.append(" (last ")
                    .append(MAX_RENDERED_ENTRIES)
                    .append(" of ")
                    .append(relevant.size())
                    .append(')');
        }
        rendered.append(':');
        for (int index = first; index < relevant.size(); index++) {
            Entry entry = relevant.get(index);
            rendered.append(System.lineSeparator())
                    .append(index + 1)
                    .append(". ")
                    .append(entry.at())
                    .append(" ")
                    .append(entry.event());
        }
        return rendered.toString();
    }

    private static boolean isNoisyPoll(String event) {
        return event.equals("event=outbox-relay")
                || event.equals("event=queue-poll")
                || event.equals("event=final-queue-poll");
    }

    private record Entry(Instant at, String event) {
    }
}
