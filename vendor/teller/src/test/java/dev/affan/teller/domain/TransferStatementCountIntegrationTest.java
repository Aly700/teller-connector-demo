package dev.affan.teller.domain;

import static org.assertj.core.api.Assertions.assertThat;

import dev.affan.teller.TestcontainersConfiguration;
import dev.affan.teller.rules.PolicyCache;
import dev.affan.teller.sqs.ApprovalExpiryWorker;
import jakarta.persistence.EntityManagerFactory;
import java.util.Set;
import java.util.UUID;
import org.hibernate.SessionFactory;
import org.hibernate.stat.Statistics;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.testcontainers.junit.jupiter.Testcontainers;

@Testcontainers(disabledWithoutDocker = true)
@Import(TestcontainersConfiguration.class)
@SpringBootTest(properties = {
        "teller.api-key=integration-key",
        "teller.aws.enabled=false",
        "teller.aws.sqs.worker-enabled=false",
        "spring.jpa.properties.hibernate.generate_statistics=true"
})
class TransferStatementCountIntegrationTest {

    private static final long ALLOW_BEFORE_TUNING = 18;
    private static final long ALLOW_AFTER_TUNING = 12; // measured with Hibernate statistics on PostgreSQL 16 (Testcontainers)
    private static final long HELD_BEFORE_TUNING = 19;
    private static final long HELD_AFTER_TUNING = 12; // measured with Hibernate statistics on PostgreSQL 16 (Testcontainers)

    @MockitoBean private ApprovalExpiryWorker approvalExpiryWorker;
    @MockitoBean private IdempotencyService idempotencyService;
    @Autowired private TransferService transferService;
    @Autowired private PolicyService policyService;
    @Autowired private PolicyCache policyCache;
    @Autowired private EntityManagerFactory entityManagerFactory;

    @Test
    void warmAllowTransferUsesTwelveStatements() {
        Transfer transfer = measuredTransfer(Effect.ALLOW, null, "allow-count");

        assertThat(transfer.getState()).isEqualTo(TransferState.POSTED);
        assertThat(statistics().getPrepareStatementCount())
                .as("ALLOW statement count; before tuning it was %d", ALLOW_BEFORE_TUNING)
                .isEqualTo(ALLOW_AFTER_TUNING);
    }

    @Test
    void warmHeldTransferUsesTwelveStatements() {
        Transfer transfer = measuredTransfer(Effect.REQUIRE_APPROVAL, 0L, "held-count");

        assertThat(transfer.getState()).isEqualTo(TransferState.HELD);
        assertThat(statistics().getPrepareStatementCount())
                .as("HELD statement count; before tuning it was %d", HELD_BEFORE_TUNING)
                .isEqualTo(HELD_AFTER_TUNING);
    }

    private Transfer measuredTransfer(Effect effect, Long fourEyesAbove, String keyPrefix) {
        Policy policy = policyService.createPolicy(new CreatePolicyCommand(
                "statement-count-" + UUID.randomUUID(), 1));
        policyService.addRule(policy.getId(), new CreateRuleCommand(
                "ledger.transfer",
                null,
                null,
                RiskTier.MEDIUM,
                effect,
                10,
                null,
                null,
                "USD",
                null,
                null,
                Set.of(),
                Set.of(),
                fourEyesAbove));
        Account source = transferService.createAccount("USD");
        transferService.deposit(source.getId(), Money.of(10_000, "USD"));
        Account destination = transferService.createAccount("USD");
        policyCache.get(policy);
        statistics().clear();

        return transferService.createTransfer(new CreateTransferCommand(
                keyPrefix + "-" + UUID.randomUUID(),
                source.getId(),
                destination.getId(),
                Money.of(1_000, "USD"),
                "initiator-one"));
    }

    private Statistics statistics() {
        return entityManagerFactory.unwrap(SessionFactory.class).getStatistics();
    }
}
