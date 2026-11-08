package dev.affan.teller.sim;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.Objects;
import java.util.PriorityQueue;
import java.util.SplittableRandom;

final class Simulator extends Clock {

    private final long seed;
    private final SplittableRandom random;
    private final Trace trace;
    private final PriorityQueue<Event> events = new PriorityQueue<>();
    private Instant now;
    private long sequence;
    private long completedSteps;

    Simulator(long seed, Instant initialTime, Trace trace) {
        this.seed = seed;
        this.random = new SplittableRandom(seed);
        this.now = Objects.requireNonNull(initialTime, "initialTime");
        this.trace = Objects.requireNonNull(trace, "trace");
    }

    long seed() {
        return seed;
    }

    boolean chance(double probability) {
        if (probability < 0.0 || probability > 1.0) {
            throw new IllegalArgumentException("probability must be between 0 and 1");
        }
        return random.nextDouble() < probability;
    }

    int nextInt(int bound) {
        return random.nextInt(bound);
    }

    long nextLong(long bound) {
        return random.nextLong(bound);
    }

    void scheduleNow(String name, Runnable action) {
        schedule(Duration.ZERO, name, action);
    }

    void schedule(Duration delay, String name, Runnable action) {
        Objects.requireNonNull(delay, "delay");
        if (delay.isNegative()) {
            throw new IllegalArgumentException("delay must not be negative");
        }
        events.add(new Event(now.plus(delay), sequence++, name, action));
    }

    void scheduleAt(Instant at, String name, Runnable action) {
        if (at.isBefore(now)) {
            throw new IllegalArgumentException("event cannot be scheduled in the past");
        }
        events.add(new Event(at, sequence++, name, action));
    }

    String runNext() {
        Event event = events.remove();
        now = event.at();
        trace.record(now, "event=" + event.name());
        event.action().run();
        completedSteps++;
        return event.name();
    }

    boolean hasEvents() {
        return !events.isEmpty();
    }

    int pendingEvents() {
        return events.size();
    }

    long completedSteps() {
        return completedSteps;
    }

    void runUntilIdle(int maxSteps, Runnable afterEachStep) {
        int steps = 0;
        while (hasEvents()) {
            if (steps++ >= maxSteps) {
                throw new AssertionError("simulation did not quiesce within " + maxSteps + " steps");
            }
            runNext();
            afterEachStep.run();
        }
    }

    @Override
    public ZoneId getZone() {
        return ZoneOffset.UTC;
    }

    @Override
    public Clock withZone(ZoneId zone) {
        if (!ZoneOffset.UTC.equals(zone)) {
            throw new IllegalArgumentException("the simulation clock is UTC-only");
        }
        return this;
    }

    @Override
    public Instant instant() {
        return now;
    }

    private record Event(Instant at, long sequence, String name, Runnable action)
            implements Comparable<Event> {

        private Event {
            Objects.requireNonNull(at, "at");
            Objects.requireNonNull(name, "name");
            Objects.requireNonNull(action, "action");
        }

        @Override
        public int compareTo(Event other) {
            int timeOrder = at.compareTo(other.at);
            return timeOrder != 0 ? timeOrder : Long.compare(sequence, other.sequence);
        }
    }
}
