package dev.affan.teller.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import dev.affan.teller.TestcontainersConfiguration;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.junit.jupiter.Testcontainers;

@Testcontainers(disabledWithoutDocker = true)
@Import({TestcontainersConfiguration.class, LedgerIntegrationTest.ClockConfiguration.class})
@SpringBootTest(properties = {
        "teller.api-key=integration-key",
        "teller.aws.enabled=false",
        "teller.aws.sqs.worker-enabled=false",
        "teller.approval.ttl=PT1M"
})
@AutoConfigureMockMvc
class LedgerIntegrationTest {

    private static final Instant START = Instant.parse("2026-08-29T00:00:00Z");

    @Autowired private TransferService transferService;
    @Autowired private PolicyService policyService;
    @Autowired private ApprovalService approvalService;
    @Autowired private ApprovalQueueService approvalQueueService;
    @Autowired private EntryRepository entries;
    @Autowired private ApprovalRepository approvals;
    @Autowired private OutboxRepositoryAccess outboxAccess;
    @Autowired private JdbcTemplate jdbcTemplate;
    @Autowired private PlatformTransactionManager transactionManager;
    @Autowired private MutableClock clock;
    @Autowired private MockMvc mockMvc;

    @BeforeEach
    void resetClock() {
        clock.set(START);
    }

    @Test
    void depositTransferAndReversalKeepEntriesBalancedAndBalancesCorrect() {
        activeRule(Effect.ALLOW, null, null, null);
        Account source = accountWithDeposit(10_000);
        Account destination = transferService.createAccount("USD");

        Transfer transfer = createTransfer(source, destination, 4_000, "allow");

        assertThat(transfer.getState()).isEqualTo(TransferState.POSTED);
        assertThat(entries.findByTransferIdOrderByCreatedAtAscIdAsc(transfer.getId()))
                .hasSize(2)
                .satisfies(rows -> assertThat(LedgerArithmetic.signedTotal(rows)).isZero());
        assertBalances(source.getId(), 6_000, 6_000);
        assertBalances(destination.getId(), 4_000, 4_000);

        transferService.reverse(transfer.getId(), "CUSTOMER_REQUEST");

        assertThat(entries.findByTransferIdOrderByCreatedAtAscIdAsc(transfer.getId()))
                .hasSize(4)
                .satisfies(rows -> assertThat(LedgerArithmetic.signedTotal(rows)).isZero());
        assertBalances(source.getId(), 10_000, 10_000);
        assertBalances(destination.getId(), 0, 0);
    }

    @Test
    void databaseRejectsAnImbalancedPostingAtCommit() {
        activeRule(Effect.ALLOW, null, null, null);
        Account source = accountWithDeposit(5_000);
        Account destination = transferService.createAccount("USD");
        Transfer transfer = createTransfer(source, destination, 1_000, "db-invariant");
        UUID postingId = entries.findByTransferIdOrderByCreatedAtAscIdAsc(transfer.getId())
                .getFirst()
                .getPostingId();
        TransactionTemplate transaction = new TransactionTemplate(transactionManager);

        assertThatThrownBy(() -> transaction.executeWithoutResult(status -> jdbcTemplate.update(
                        """
                        insert into entries(
                            id, posting_id, transfer_id, account_id, direction,
                            amount_minor, currency, created_at
                        ) values (?, ?, ?, ?, 'DEBIT', 1, 'USD', ?)
                        """,
                        UUID.randomUUID(),
                        postingId,
                        transfer.getId(),
                        source.getId(),
                        java.sql.Timestamp.from(clock.instant()))))
                .rootCause()
                .hasMessageContaining("posting %s entries are not balanced (signed total -1)"
                        .formatted(postingId));
    }

    @Test
    void policyDenyCreatesADeniedTransferWithoutMovingMoney() {
        activeRule(Effect.DENY, 1_000L, null, null);
        Account source = accountWithDeposit(5_000);
        Account destination = transferService.createAccount("USD");

        Transfer transfer = createTransfer(source, destination, 1_000, "deny");

        assertThat(transfer.getState()).isEqualTo(TransferState.DENIED);
        assertThat(transfer.getReasonCode()).isEqualTo("POLICY_DENIED");
        assertThat(entries.findByTransferIdOrderByCreatedAtAscIdAsc(transfer.getId())).isEmpty();
        assertBalances(source.getId(), 5_000, 5_000);
        assertBalances(destination.getId(), 0, 0);
    }

    @Test
    void requireApprovalReservesThenApprovePostsInTheExistingTransactionFlow() throws Exception {
        activeRule(Effect.REQUIRE_APPROVAL, null, null, 5_000L);
        Account source = accountWithDeposit(10_000);
        Account destination = transferService.createAccount("USD");

        Transfer held = createTransfer(source, destination, 6_000, "held-approve");

        assertThat(held.getState()).isEqualTo(TransferState.HELD);
        assertBalances(source.getId(), 10_000, 4_000);
        assertThat(approvals.findById(held.getApprovalId())).isPresent();
        assertThat(outboxAccess.countForApproval(held.getApprovalId())).isEqualTo(1);
        assertThat(approvalQueueService.getTransfer(held.getApprovalId())).satisfies(details -> {
            assertThat(details.transferId()).isEqualTo(held.getId());
            assertThat(details.amountMinor()).isEqualTo(6_000);
            assertThat(details.fromAccountId()).isEqualTo(source.getId());
            assertThat(details.toAccountId()).isEqualTo(destination.getId());
            assertThat(details.matchedRuleId()).isNotNull();
        });
        mockMvc.perform(get("/approvals/{id}/transfer", held.getApprovalId())
                        .header("X-API-Key", "integration-key"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.transferId").value(held.getId().toString()))
                .andExpect(jsonPath("$.amountMinor").value("6000"))
                .andExpect(jsonPath("$.matchedRuleId").isNotEmpty());

        approvalService.approve(held.getApprovalId(), "reviewer-two", "Invoice verified");

        assertThat(transferService.getTransfer(held.getId()).getState()).isEqualTo(TransferState.POSTED);
        assertBalances(source.getId(), 4_000, 4_000);
        assertBalances(destination.getId(), 6_000, 6_000);
        assertThat(entries.findByTransferIdOrderByCreatedAtAscIdAsc(held.getId())).hasSize(2);
        assertThat(approvals.findById(held.getApprovalId()).orElseThrow().getReason())
                .isEqualTo("Invoice verified");
    }

    @Test
    void approvalDenialAndExpiryBothReleaseTheReservation() {
        activeRule(Effect.REQUIRE_APPROVAL, null, null, 0L);
        Account source = accountWithDeposit(10_000);
        Account destination = transferService.createAccount("USD");
        Transfer denied = createTransfer(source, destination, 2_000, "held-deny");

        approvalService.deny(denied.getApprovalId(), "reviewer-two");

        assertThat(transferService.getTransfer(denied.getId()).getState()).isEqualTo(TransferState.REVERSED);
        assertBalances(source.getId(), 10_000, 10_000);

        Transfer expiring = createTransfer(source, destination, 3_000, "held-expire");
        assertBalances(source.getId(), 10_000, 7_000);
        clock.advance(Duration.ofMinutes(2));

        assertThat(approvalService.expireStale()).isEqualTo(1);
        assertThat(transferService.getTransfer(expiring.getId()).getState()).isEqualTo(TransferState.REVERSED);
        assertThat(transferService.getTransfer(expiring.getId()).getReasonCode())
                .isEqualTo("APPROVAL_EXPIRED");
        assertBalances(source.getId(), 10_000, 10_000);
    }

    @Test
    void concurrentTransfersCannotBothDrainTheSameAvailableBalance() throws Exception {
        activeRule(Effect.ALLOW, null, null, null);
        Account source = accountWithDeposit(10_000);
        Account firstDestination = transferService.createAccount("USD");
        Account secondDestination = transferService.createAccount("USD");
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);

        try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
            Future<Transfer> first = executor.submit(() -> concurrentTransfer(
                    ready, start, source, firstDestination, "concurrent-one"));
            Future<Transfer> second = executor.submit(() -> concurrentTransfer(
                    ready, start, source, secondDestination, "concurrent-two"));
            ready.await();
            start.countDown();

            List<TransferState> states = List.of(first.get().getState(), second.get().getState());
            assertThat(states).containsExactlyInAnyOrder(TransferState.POSTED, TransferState.DENIED);
        }
        assertBalances(source.getId(), 2_000, 2_000);
        long credited = transferService.getAccount(firstDestination.getId()).getLedgerBalanceMinor()
                + transferService.getAccount(secondDestination.getId()).getLedgerBalanceMinor();
        assertThat(credited).isEqualTo(8_000);
    }

    private Transfer concurrentTransfer(
            CountDownLatch ready,
            CountDownLatch start,
            Account source,
            Account destination,
            String key) throws InterruptedException {
        ready.countDown();
        start.await();
        return createTransfer(source, destination, 8_000, key);
    }

    private Policy activeRule(Effect effect, Long minimum, Long maximum, Long fourEyesAbove) {
        Policy policy = policyService.createPolicy(new CreatePolicyCommand(
                "ledger-" + UUID.randomUUID(), 1));
        policyService.addRule(policy.getId(), new CreateRuleCommand(
                "ledger.transfer",
                null,
                null,
                RiskTier.MEDIUM,
                effect,
                10,
                minimum,
                maximum,
                "USD",
                null,
                null,
                Set.of(),
                Set.of(),
                fourEyesAbove));
        return policy;
    }

    private Account accountWithDeposit(long amountMinor) {
        Account account = transferService.createAccount("USD");
        return transferService.deposit(account.getId(), Money.of(amountMinor, "USD"));
    }

    private Transfer createTransfer(Account source, Account destination, long amountMinor, String keyPrefix) {
        return transferService.createTransfer(new CreateTransferCommand(
                keyPrefix + "-" + UUID.randomUUID(),
                source.getId(),
                destination.getId(),
                Money.of(amountMinor, "USD"),
                "initiator-one"));
    }

    private void assertBalances(UUID accountId, long ledger, long available) {
        Account account = transferService.getAccount(accountId);
        assertThat(account.getLedgerBalanceMinor()).isEqualTo(ledger);
        assertThat(account.getAvailableBalanceMinor()).isEqualTo(available);
        assertThat(account.getAvailableBalanceMinor()).isNotNegative();
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class ClockConfiguration {

        @Bean
        @Primary
        MutableClock mutableClock() {
            return new MutableClock(START);
        }

        @Bean
        OutboxRepositoryAccess outboxRepositoryAccess(JdbcTemplate jdbcTemplate) {
            return approvalId -> jdbcTemplate.queryForObject(
                    "select count(*) from outbox_messages where aggregate_id = ?",
                    Long.class,
                    approvalId);
        }
    }

    @FunctionalInterface
    interface OutboxRepositoryAccess {
        long countForApproval(UUID approvalId);
    }

    static final class MutableClock extends Clock {

        private volatile Instant instant;

        MutableClock(Instant instant) {
            this.instant = instant;
        }

        void set(Instant instant) {
            this.instant = instant;
        }

        void advance(Duration duration) {
            instant = instant.plus(duration);
        }

        @Override
        public ZoneId getZone() {
            return ZoneId.of("UTC");
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return instant;
        }
    }
}
