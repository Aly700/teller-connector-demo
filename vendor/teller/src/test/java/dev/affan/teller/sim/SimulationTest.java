package dev.affan.teller.sim;

import dev.affan.teller.config.AwsProperties;
import dev.affan.teller.domain.Account;
import dev.affan.teller.domain.Approval;
import dev.affan.teller.domain.ApprovalService;
import dev.affan.teller.domain.ApprovalStatus;
import dev.affan.teller.domain.AuditService;
import dev.affan.teller.domain.CreatePolicyCommand;
import dev.affan.teller.domain.CreateRuleCommand;
import dev.affan.teller.domain.CreateTransferCommand;
import dev.affan.teller.domain.DecisionService;
import dev.affan.teller.domain.Effect;
import dev.affan.teller.domain.IdempotencyService;
import dev.affan.teller.domain.Money;
import dev.affan.teller.domain.Policy;
import dev.affan.teller.domain.PolicyService;
import dev.affan.teller.domain.RiskTier;
import dev.affan.teller.domain.Transfer;
import dev.affan.teller.domain.TransferService;
import dev.affan.teller.domain.TransferSettlementService;
import dev.affan.teller.domain.TransferState;
import dev.affan.teller.rules.RulesEngine;
import dev.affan.teller.rules.PolicyCache;
import dev.affan.teller.sqs.ApprovalExpiryWorker;
import dev.affan.teller.sqs.ApprovalMessageCodec;
import dev.affan.teller.sqs.ApprovalMessageValidator;
import dev.affan.teller.sqs.ApprovalQueueWorker;
import dev.affan.teller.sqs.OutboxRelay;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

class SimulationTest {

    private static final Instant INITIAL_TIME = Instant.parse("2026-08-29T00:00:00Z");
    private static final int DEFAULT_SEEDS = 200;
    private static final List<String> CURRENCIES = List.of("USD", "EUR", "CAD");

    @Test
    void seededFaultsPreserveProductionMoneyInvariants() {
        long started = System.nanoTime();
        ObjectMapper objectMapper = new ObjectMapper();
        SimulationCoverage coverage = new SimulationCoverage();
        String exactSeed = System.getProperty("sim.seed");
        int seedsRun;
        if (exactSeed != null) {
            runSeed(Long.parseLong(exactSeed), coverage);
            seedsRun = 1;
        } else {
            int seedCount = Integer.getInteger("sim.seeds", DEFAULT_SEEDS);
            if (seedCount < 1) {
                throw new IllegalArgumentException("sim.seeds must be positive");
            }
            for (long seed = 1; seed <= seedCount; seed++) {
                runSeed(seed, coverage);
            }
            seedsRun = seedCount;
        }
        Duration elapsed = Duration.ofNanos(System.nanoTime() - started);
        String summary = coverage.write(objectMapper, elapsed);
        System.out.printf("simulation seeds=%d elapsed_ms=%d%n", seedsRun, elapsed.toMillis());
        System.out.println("simulation coverage=" + summary);
        coverage.requireRequiredCoverage(seedsRun);
        if (exactSeed == null && seedsRun >= 2_000 && elapsed.compareTo(Duration.ofSeconds(60)) >= 0) {
            throw new AssertionError("2,000 simulation seeds must complete in under 60 seconds");
        }
    }

    private static void runSeed(long seed, SimulationCoverage coverage) {
        Trace trace = new Trace(seed);
        try {
            Simulator simulator = new Simulator(seed, INITIAL_TIME, trace);
            InMemoryStores stores = new InMemoryStores(trace, simulator::instant);
            ObjectMapper objectMapper = new ObjectMapper();
            ApprovalMessageCodec codec = new ApprovalMessageCodec(objectMapper);
            FaultInjectingBus bus = FaultInjectingBus.standard(simulator, trace, codec);
            Invariants invariants = new Invariants(stores, bus);

            AuditService auditService = new AuditService(stores.auditStore(), objectMapper, simulator);
            PolicyCache policyCache = new PolicyCache(stores.policyStore(), stores.ruleStore());
            DecisionService decisionService = new DecisionService(
                    policyCache,
                    stores.decisionStore(),
                    stores.approvalStore(),
                    new RulesEngine(),
                    stores.outboxStore(),
                    codec,
                    auditService,
                    simulator,
                    Duration.ofSeconds(2));
            TransferSettlementService settlementService = new TransferSettlementService(
                    stores.transferStore(),
                    stores.accountStore(),
                    stores.entryStore(),
                    auditService,
                    simulator);
            ApprovalService approvalService = new ApprovalService(
                    stores.approvalStore(),
                    auditService,
                    simulator,
                    new ApprovalMessageValidator(),
                    settlementService);
            PolicyService policyService = new PolicyService(
                    stores.policyStore(), stores.ruleStore(), auditService, policyCache, simulator);
            TransferService transferService = new TransferService(
                    stores.accountStore(),
                    stores.transferStore(),
                    stores.entryStore(),
                    stores.policyStore(),
                    policyCache,
                    decisionService,
                    auditService,
                    simulator);
            IdempotencyService idempotencyService = new IdempotencyService(
                    stores.idempotencyStore(), simulator, Duration.ofHours(24));
            OutboxRelay relay = new OutboxRelay(
                    stores.outboxStore(),
                    bus,
                    codec,
                    new SimpleMeterRegistry(),
                    simulator);
            ApprovalQueueWorker queueWorker = new ApprovalQueueWorker(
                    bus.sqsClient(),
                    codec,
                    bus.processor(approvalService),
                    stores.processedMessagesJdbc(simulator::instant),
                    stores.transactionManager(),
                    simulator,
                    workerProperties());
            ApprovalExpiryWorker expiryWorker = new ApprovalExpiryWorker(approvalService);

            Map<String, List<Account>> accounts = createFundedAccounts(simulator, transferService);
            createPolicy(seed, simulator, accounts, policyService);
            List<TransferAttempt> attempts = transferAttempts(seed, simulator, accounts);
            scheduleTransfers(
                    attempts,
                    transferService,
                    idempotencyService,
                    objectMapper,
                    stores,
                    bus,
                    simulator);
            scheduleTransport(relay, queueWorker, bus, simulator);
            simulator.schedule(Duration.ofMillis(1_400), "human-approval-decisions", () ->
                    decideSomeApprovals(seed, stores, approvalService, bus, simulator));
            simulator.schedule(Duration.ofSeconds(3), "clock-jump-past-approval-expiry", () ->
                    expireWithFaults(expiryWorker, bus));
            simulator.schedule(Duration.ofSeconds(5), "healthy-period", bus::recover);
            simulator.schedule(Duration.ofMillis(5_010), "final-outbox-relay", relay::relayOnce);
            for (int index = 0; index < 16; index++) {
                simulator.schedule(
                        Duration.ofMillis(5_100L + index * 100L),
                        "final-queue-poll",
                        queueWorker::poll);
            }
            simulator.schedule(Duration.ofMillis(6_800), "final-expiry-sweep",
                    expiryWorker::expireStaleApprovals);

            simulator.runUntilIdle(10_000, invariants::checkAfterStep);
            invariants.checkAfterQuiescence();
            coverage.include(simulator, stores, bus);
        } catch (Throwable failure) {
            throw trace.failure(failure);
        }
    }

    private static Map<String, List<Account>> createFundedAccounts(
            Simulator simulator,
            TransferService transferService) {
        int currencyCount = 2 + simulator.nextInt(2);
        int firstCurrency = simulator.nextInt(CURRENCIES.size());
        Map<String, List<Account>> accounts = new LinkedHashMap<>();
        for (int currencyIndex = 0; currencyIndex < currencyCount; currencyIndex++) {
            String currency = CURRENCIES.get((firstCurrency + currencyIndex) % CURRENCIES.size());
            int accountCount = 3 + simulator.nextInt(2);
            List<Account> group = new ArrayList<>();
            for (int index = 0; index < accountCount; index++) {
                Account account = transferService.createAccount(currency);
                long deposit = 8_000L + simulator.nextLong(12_001L);
                group.add(transferService.deposit(account.getId(), Money.of(deposit, currency)));
            }
            accounts.put(currency, List.copyOf(group));
        }
        return Map.copyOf(accounts);
    }

    private static void createPolicy(
            long seed,
            Simulator simulator,
            Map<String, List<Account>> accounts,
            PolicyService policyService) {
        Policy policy = policyService.createPolicy(new CreatePolicyCommand("simulation-" + seed, 1));
        int precedence = 10;
        for (Map.Entry<String, List<Account>> currencyAccounts : accounts.entrySet()) {
            String currency = currencyAccounts.getKey();
            List<Account> group = currencyAccounts.getValue();
            UUID deniedCounterparty = group.getLast().getId();
            Set<UUID> allowedCounterparties = group.stream()
                    .map(Account::getId)
                    .filter(id -> !id.equals(deniedCounterparty))
                    .collect(java.util.stream.Collectors.toUnmodifiableSet());
            policyService.addRule(policy.getId(), rule(
                    Effect.DENY, precedence++, null, null, currency,
                    null, null, Set.of(), Set.of(deniedCounterparty), null));
            policyService.addRule(policy.getId(), rule(
                    Effect.DENY, precedence++, 12_001L, null, currency,
                    null, null, Set.of(), Set.of(), null));
            policyService.addRule(policy.getId(), rule(
                    Effect.REQUIRE_APPROVAL, precedence++, 4_001L, 12_000L, currency,
                    null, null, Set.of(), Set.of(), 4_000L));
            policyService.addRule(policy.getId(), rule(
                    Effect.ALLOW, precedence++, 1L, 4_000L, currency,
                    3 + simulator.nextInt(3), 10L, allowedCounterparties, Set.of(), null));
        }
    }

    private static CreateRuleCommand rule(
            Effect effect,
            int precedence,
            Long minimum,
            Long maximum,
            String currency,
            Integer velocityMax,
            Long velocityWindowSeconds,
            Set<UUID> counterpartyAllow,
            Set<UUID> counterpartyDeny,
            Long fourEyesAbove) {
        return new CreateRuleCommand(
                "ledger.transfer",
                null,
                null,
                RiskTier.MEDIUM,
                effect,
                precedence,
                minimum,
                maximum,
                currency,
                velocityMax,
                velocityWindowSeconds,
                counterpartyAllow,
                counterpartyDeny,
                fourEyesAbove);
    }

    private static List<TransferAttempt> transferAttempts(
            long seed,
            Simulator simulator,
            Map<String, List<Account>> accounts) {
        List<TransferAttempt> attempts = new ArrayList<>();
        int sequence = 0;
        for (Map.Entry<String, List<Account>> currencyAccounts : accounts.entrySet()) {
            String currency = currencyAccounts.getKey();
            List<Account> group = currencyAccounts.getValue();
            Account source = group.getFirst();
            Account allowedDestination = group.get(1);
            Account deniedDestination = group.getLast();
            attempts.add(attempt(seed, sequence++, source, allowedDestination, 1_000, currency, false));
            attempts.add(attempt(seed, sequence++, source, allowedDestination, 6_000, currency, false));
            attempts.add(attempt(seed, sequence++, source, allowedDestination, 13_000, currency, false));
            attempts.add(attempt(seed, sequence++, source, deniedDestination, 500, currency, false));
            for (int count = 0; count < 5; count++) {
                attempts.add(attempt(seed, sequence++, source, allowedDestination,
                        200L + simulator.nextLong(1_000L), currency, false));
            }
            long drainAmount = Math.max(4_001L, source.getAvailableBalanceMinor() * 2 / 3);
            attempts.add(attempt(
                    seed, sequence++, source, allowedDestination, drainAmount, currency, true));
            attempts.add(attempt(seed, sequence++, source, group.get(2), drainAmount, currency, true));
        }
        int randomAttempts = 4 + simulator.nextInt(7);
        List<Map.Entry<String, List<Account>>> groups = new ArrayList<>(accounts.entrySet());
        for (int index = 0; index < randomAttempts; index++) {
            Map.Entry<String, List<Account>> group = groups.get(simulator.nextInt(groups.size()));
            List<Account> choices = group.getValue();
            int sourceIndex = simulator.nextInt(choices.size());
            int destinationIndex = (sourceIndex + 1 + simulator.nextInt(choices.size() - 1)) % choices.size();
            long amount = 1L + simulator.nextLong(15_000L);
            attempts.add(attempt(
                    seed,
                    sequence++,
                    choices.get(sourceIndex),
                    choices.get(destinationIndex),
                    amount,
                    group.getKey(),
                    false));
        }
        return List.copyOf(attempts);
    }

    private static TransferAttempt attempt(
            long seed,
            int sequence,
            Account source,
            Account destination,
            long amountMinor,
            String currency,
            boolean concurrentDrain) {
        String key = "sim-" + seed + "-transfer-" + sequence;
        return new TransferAttempt(
                key,
                new CreateTransferCommand(
                        key,
                        source.getId(),
                        destination.getId(),
                        Money.of(amountMinor, currency),
                        "sim-initiator"),
                concurrentDrain);
    }

    private static void scheduleTransfers(
            List<TransferAttempt> attempts,
            TransferService transferService,
            IdempotencyService idempotencyService,
            ObjectMapper objectMapper,
            InMemoryStores stores,
            FaultInjectingBus bus,
            Simulator simulator) {
        for (int index = 0; index < attempts.size(); index++) {
            TransferAttempt attempt = attempts.get(index);
            long firstAt = 100L + index * 12L;
            if (attempt.concurrentDrain()) {
                firstAt = 450L;
            }
            simulator.schedule(
                    Duration.ofMillis(firstAt),
                    (attempt.concurrentDrain() ? "concurrent-drain " : "transfer-attempt ")
                            + "key=" + attempt.key(),
                    () -> submitWithFaults(
                            attempt,
                            transferService,
                            idempotencyService,
                            objectMapper,
                            stores,
                            bus,
                            simulator));
            simulator.schedule(
                    Duration.ofMillis(750L + index * 5L),
                    "transfer-retry key=" + attempt.key(),
                    () -> submit(
                            attempt,
                            transferService,
                            idempotencyService,
                            objectMapper,
                            stores,
                            simulator));
            simulator.schedule(
                    Duration.ofMillis(1_050L + index * 5L),
                    "transfer-idempotent-replay key=" + attempt.key(),
                    () -> submit(
                            attempt,
                            transferService,
                            idempotencyService,
                            objectMapper,
                            stores,
                            simulator));
        }
    }

    private static void submitWithFaults(
            TransferAttempt attempt,
            TransferService transferService,
            IdempotencyService idempotencyService,
            ObjectMapper objectMapper,
            InMemoryStores stores,
            FaultInjectingBus bus,
            Simulator simulator) {
        if (bus.crashBeforeCommit("transfer")) {
            return;
        }
        submit(attempt, transferService, idempotencyService, objectMapper, stores, simulator);
        bus.crashAfterCommit("transfer");
    }

    private static Transfer submit(
            TransferAttempt attempt,
            TransferService transferService,
            IdempotencyService idempotencyService,
            ObjectMapper objectMapper,
            InMemoryStores stores,
            Simulator simulator) {
        String requestHash = idempotencyService.requestHash(objectMapper.valueToTree(attempt.command()));
        IdempotencyService.StoredResponse response = idempotencyService.execute(
                attempt.key(),
                requestHash,
                () -> {
                    Transfer transfer = transferService.createTransfer(attempt.command());
                    return new IdempotencyService.StoredResponse(
                            201,
                            objectMapper.writeValueAsString(Map.of("id", transfer.getId())));
                });
        UUID transferId = UUID.fromString(objectMapper.readTree(response.responseBody()).get("id").asText());
        Transfer transfer = stores.findTransferById(transferId).orElseThrow();
        stores.recordTransferIdempotencyResult(
                attempt.key(), transfer, simulator.instant(), response.statusCode() == 200);
        return transfer;
    }

    private static void scheduleTransport(
            OutboxRelay relay,
            ApprovalQueueWorker queueWorker,
            FaultInjectingBus bus,
            Simulator simulator) {
        for (int index = 0; index < 48; index++) {
            simulator.schedule(Duration.ofMillis(600L + index * 90L), "outbox-relay", relay::relayOnce);
            simulator.schedule(Duration.ofMillis(645L + index * 90L), "queue-poll", queueWorker::poll);
        }
    }

    private static void decideSomeApprovals(
            long seed,
            InMemoryStores stores,
            ApprovalService approvalService,
            FaultInjectingBus bus,
            Simulator simulator) {
        List<Approval> approvals = new ArrayList<>(stores.approvals());
        for (int index = 0; index < approvals.size(); index++) {
            Approval approval = approvals.get(index);
            if (approval.getStatus() != ApprovalStatus.PENDING
                    || !simulator.instant().isBefore(approval.getExpiresAt())) {
                continue;
            }
            int outcome = Math.floorMod((int) seed + index, 3);
            if (outcome < 2 && bus.crashBeforeCommit("approval")) {
                continue;
            }
            if (outcome == 0) {
                approvalService.approve(approval.getId(), "sim-reviewer");
            } else if (outcome == 1) {
                approvalService.deny(approval.getId(), "sim-reviewer");
            }
            if (outcome < 2) {
                bus.crashAfterCommit("approval");
            }
        }
    }

    private static void expireWithFaults(
            ApprovalExpiryWorker expiryWorker,
            FaultInjectingBus bus) {
        if (bus.crashBeforeCommit("approval-expiry")) {
            return;
        }
        expiryWorker.expireStaleApprovals();
        bus.crashAfterCommit("approval-expiry");
    }

    private static AwsProperties workerProperties() {
        AwsProperties properties = new AwsProperties();
        properties.getSqs().setQueueUrl("memory://approval-queue");
        properties.getSqs().setWaitTimeSeconds(0);
        properties.getSqs().setMaxMessages(10);
        return properties;
    }

    private record TransferAttempt(
            String key,
            CreateTransferCommand command,
            boolean concurrentDrain) {
    }
}
