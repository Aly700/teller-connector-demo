package dev.affan.teller.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import dev.affan.teller.TestcontainersConfiguration;
import dev.affan.teller.domain.DecisionRepository;
import dev.affan.teller.domain.Account;
import dev.affan.teller.domain.CreatePolicyCommand;
import dev.affan.teller.domain.CreateRuleCommand;
import dev.affan.teller.domain.Effect;
import dev.affan.teller.domain.Money;
import dev.affan.teller.domain.Policy;
import dev.affan.teller.domain.PolicyService;
import dev.affan.teller.domain.TransferRepository;
import dev.affan.teller.domain.TransferService;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.testcontainers.junit.jupiter.Testcontainers;
import tools.jackson.databind.ObjectMapper;

@Testcontainers(disabledWithoutDocker = true)
@Import(TestcontainersConfiguration.class)
@SpringBootTest(properties = {
        "teller.api-key=integration-key",
        "teller.aws.enabled=false",
        "teller.idempotency.sweep-interval=PT1H"
})
@AutoConfigureMockMvc
class IdempotencyIntegrationTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;
    @Autowired private DecisionRepository decisions;
    @Autowired private TransferRepository transfers;
    @Autowired private TransferService transferService;
    @Autowired private PolicyService policyService;
    @Autowired private JdbcTemplate jdbcTemplate;

    @Test
    void replayReturnsIdenticalBodyWithOkStatus() throws Exception {
        String policyId = createPolicy();
        String key = "replay-" + UUID.randomUUID();
        String firstRequest = decisionRequest(policyId, "agent-1", "fs.read", "{\"b\":2,\"a\":1}");
        String reorderedRequest = """
                {"riskTier":"LOW","arguments":{"a":1,"b":2},"toolName":"fs.read",
                 "agentId":"agent-1","policyId":"%s"}
                """.formatted(policyId);
        long before = decisions.count();

        MvcResult first = postDecision(key, firstRequest);
        MvcResult replay = postDecision(key, reorderedRequest);

        assertThat(first.getResponse().getStatus()).isEqualTo(201);
        assertThat(replay.getResponse().getStatus()).isEqualTo(200);
        assertThat(replay.getResponse().getContentAsString())
                .isEqualTo(first.getResponse().getContentAsString());
        assertThat(decisions.count()).isEqualTo(before + 1);
    }

    @Test
    void sameKeyWithDifferentBodyReturnsConflict() throws Exception {
        String policyId = createPolicy();
        String key = "conflict-" + UUID.randomUUID();
        postDecision(key, decisionRequest(policyId, "agent-1", "fs.read", "{}"));

        MvcResult conflict = postDecision(
                key,
                decisionRequest(policyId, "agent-2", "fs.read", "{}"));

        assertThat(conflict.getResponse().getStatus()).isEqualTo(409);
        assertThat(objectMapper.readTree(conflict.getResponse().getContentAsString()).get("detail").asString())
                .isEqualTo("Idempotency-Key was already used with a different request body.");
    }

    @Test
    void concurrentDuplicatesCreateOneDecision() throws Exception {
        String policyId = createPolicy();
        String key = "concurrent-" + UUID.randomUUID();
        String body = decisionRequest(policyId, "agent-1", "fs.read", "{}");
        long before = decisions.count();
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);

        try (var executor = Executors.newFixedThreadPool(2)) {
            List<Future<MvcResult>> futures = List.of(
                    executor.submit(() -> concurrentPost(key, body, ready, start)),
                    executor.submit(() -> concurrentPost(key, body, ready, start)));
            ready.await();
            start.countDown();
            MvcResult first = futures.get(0).get();
            MvcResult second = futures.get(1).get();

            assertThat(List.of(first.getResponse().getStatus(), second.getResponse().getStatus()))
                    .containsExactlyInAnyOrder(200, 201);
            assertThat(first.getResponse().getContentAsString())
                    .isEqualTo(second.getResponse().getContentAsString());
        }
        assertThat(decisions.count()).isEqualTo(before + 1);
    }

    @Test
    void keyOlderThanTtlIsAcceptedAsNew() throws Exception {
        String policyId = createPolicy();
        String key = "expired-" + UUID.randomUUID();
        MvcResult first = postDecision(
                key,
                decisionRequest(policyId, "agent-1", "fs.read", "{}"));
        jdbcTemplate.update(
                "UPDATE idempotency_records SET created_at = ? WHERE key = ?",
                Timestamp.from(Instant.now().minus(25, ChronoUnit.HOURS)),
                key);

        MvcResult second = postDecision(
                key,
                decisionRequest(policyId, "agent-2", "fs.read", "{}"));

        assertThat(second.getResponse().getStatus()).isEqualTo(201);
        assertThat(responseId(second)).isNotEqualTo(responseId(first));
    }

    @Test
    void transferReplayMovesMoneyOnlyOnceAndReturnsTheStoredTransfer() throws Exception {
        Policy policy = policyService.createPolicy(new CreatePolicyCommand(
                "transfer-idempotency-" + UUID.randomUUID(), 1));
        policyService.addRule(policy.getId(), new CreateRuleCommand(
                "ledger.transfer", null, null, null, Effect.ALLOW, 10));
        Account source = transferService.createAccount("USD");
        source = transferService.deposit(source.getId(), Money.of(10_000, "USD"));
        Account destination = transferService.createAccount("USD");
        String key = "transfer-replay-" + UUID.randomUUID();
        String body = """
                {"fromAccountId":"%s","toAccountId":"%s","amountMinor":4000,
                 "currency":"USD","initiatedBy":"maker-one"}
                """.formatted(source.getId(), destination.getId());
        long before = transfers.count();

        MvcResult first = postTransfer(key, body);
        MvcResult replay = postTransfer(key, body);

        assertThat(first.getResponse().getStatus()).isEqualTo(201);
        assertThat(replay.getResponse().getStatus()).isEqualTo(200);
        assertThat(replay.getResponse().getContentAsString())
                .isEqualTo(first.getResponse().getContentAsString());
        assertThat(transfers.count()).isEqualTo(before + 1);
        assertThat(transferService.getAccount(source.getId()).getLedgerBalanceMinor()).isEqualTo(6_000);
        assertThat(transferService.getAccount(destination.getId()).getLedgerBalanceMinor()).isEqualTo(4_000);
    }

    @Test
    void transferRequiresAnIdempotencyKey() throws Exception {
        MvcResult result = mockMvc.perform(post("/transfers")
                        .header("X-API-Key", "integration-key")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andReturn();

        assertThat(result.getResponse().getStatus()).isEqualTo(400);
    }

    private MvcResult concurrentPost(
            String key,
            String body,
            CountDownLatch ready,
            CountDownLatch start) throws Exception {
        ready.countDown();
        start.await();
        return postDecision(key, body);
    }

    private MvcResult postDecision(String key, String body) throws Exception {
        return mockMvc.perform(post("/decisions")
                        .header("X-API-Key", "integration-key")
                        .header("Idempotency-Key", key)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andReturn();
    }

    private MvcResult postTransfer(String key, String body) throws Exception {
        return mockMvc.perform(post("/transfers")
                        .header("X-API-Key", "integration-key")
                        .header("Idempotency-Key", key)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andReturn();
    }

    private String createPolicy() throws Exception {
        String response = mockMvc.perform(post("/policies")
                        .header("X-API-Key", "integration-key")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"idempotency-%s\",\"version\":1}".formatted(UUID.randomUUID())))
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response).get("id").asString();
    }

    private static String decisionRequest(
            String policyId,
            String agentId,
            String toolName,
            String arguments) {
        return """
                {"policyId":"%s","agentId":"%s","toolName":"%s",
                 "arguments":%s,"riskTier":"LOW"}
                """.formatted(policyId, agentId, toolName, arguments);
    }

    private UUID responseId(MvcResult result) throws Exception {
        return UUID.fromString(objectMapper.readTree(result.getResponse().getContentAsString()).get("id").asString());
    }
}
