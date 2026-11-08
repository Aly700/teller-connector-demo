package dev.affan.teller.sqs;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import dev.affan.teller.LocalStackIntegrationTest;
import dev.affan.teller.TestcontainersConfiguration;
import dev.affan.teller.domain.Approval;
import dev.affan.teller.domain.ApprovalRepository;
import dev.affan.teller.domain.ApprovalStatus;
import java.time.Duration;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.CreateBucketRequest;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.ListObjectsV2Request;
import software.amazon.awssdk.services.s3.model.S3Exception;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.CreateQueueRequest;
import software.amazon.awssdk.services.sqs.model.DeleteMessageRequest;
import software.amazon.awssdk.services.sqs.model.GetQueueUrlRequest;
import software.amazon.awssdk.services.sqs.model.ReceiveMessageRequest;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@Import(TestcontainersConfiguration.class)
@SpringBootTest(properties = {
        "teller.api-key=integration-key",
        "teller.aws.enabled=true",
        "teller.aws.sqs.worker-enabled=false",
        "teller.outbox.relay-initial-delay=PT1H",
        "teller.approval.ttl=PT0.1S"
})
@AutoConfigureMockMvc
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class AwsTransportIntegrationTest extends LocalStackIntegrationTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;
    @Autowired private ApprovalMessageCodec codec;
    @Autowired private ApprovalRepository approvals;
    @Autowired private ApprovalExpiryWorker expiryWorker;
    @Autowired private OutboxRelay outboxRelay;
    @Autowired private SqsClient sqsClient;
    @Autowired private S3Client s3Client;

    @BeforeEach
    void createsAwsResources() {
        sqsClient.createQueue(CreateQueueRequest.builder().queueName(QUEUE_NAME).build());
        try {
            s3Client.createBucket(CreateBucketRequest.builder().bucket(BUCKET_NAME).build());
        } catch (S3Exception exception) {
            if (exception.statusCode() != 409) {
                throw exception;
            }
        }
    }

    @Test
    @Order(1)
    void publishesApprovalRequestAndRecordsApiApproval() throws Exception {
        CreatedApproval created = createApprovalRequiredDecision();
        String queueUrl = queueUrl();

        List<software.amazon.awssdk.services.sqs.model.Message> messages = sqsClient.receiveMessage(
                ReceiveMessageRequest.builder()
                        .queueUrl(queueUrl)
                        .waitTimeSeconds(5)
                        .maxNumberOfMessages(10)
                        .build()).messages();

        assertThat(messages).hasSize(1);
        assertThat(codec.decode(messages.getFirst().body()))
                .extracting(ApprovalMessage::approvalId, ApprovalMessage::decisionId)
                .containsExactly(created.approvalId(), created.decisionId());
        sqsClient.deleteMessage(DeleteMessageRequest.builder()
                        .queueUrl(queueUrl)
                        .receiptHandle(messages.getFirst().receiptHandle())
                        .build());

        mockMvc.perform(post("/approvals/{id}/approve", created.approvalId())
                        .header("X-API-Key", "integration-key")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"decidedBy\":\"reviewer-1\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("APPROVED"));

        mockMvc.perform(get("/audit")
                        .header("X-API-Key", "integration-key")
                        .param("from", "2026-01-01T00:00:00Z")
                        .param("to", "2027-01-01T00:00:00Z"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.eventType == 'APPROVAL_CREATED')]").exists())
                .andExpect(jsonPath("$[?(@.eventType == 'APPROVAL_APPROVED')]").exists());
    }

    @Test
    @Order(2)
    void expiresAStaleApprovalAndAuditsTheTransition() throws Exception {
        CreatedApproval created = createApprovalRequiredDecision();
        Thread.sleep(Duration.ofMillis(250));

        mockMvc.perform(post("/approvals/{id}/approve", created.approvalId())
                        .header("X-API-Key", "integration-key")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"decidedBy\":\"too-late-reviewer\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.detail").value("approval is expired"));

        assertThat(expiryWorker.expireStaleApprovals()).isEqualTo(1);

        Approval approval = approvals.findById(created.approvalId()).orElseThrow();
        assertThat(approval.getStatus()).isEqualTo(ApprovalStatus.EXPIRED);
        mockMvc.perform(get("/audit")
                        .header("X-API-Key", "integration-key")
                        .param("from", "2026-01-01T00:00:00Z")
                        .param("to", "2027-01-01T00:00:00Z"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.eventType == 'APPROVAL_EXPIRED')]").exists());
    }

    @Test
    @Order(3)
    void exportsIdempotentJsonLinesToS3() throws Exception {
        createApprovalRequiredDecision();
        LocalDate date = LocalDate.now(ZoneOffset.UTC);

        String firstResponse = mockMvc.perform(post("/admin/exports/audit")
                        .header("X-API-Key", "integration-key")
                        .param("date", date.toString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.objectKey").value(
                        "audit/dt=" + date + "/" + date.toString().replace("-", "") + "T000000Z.jsonl"))
                .andReturn().getResponse().getContentAsString();
        mockMvc.perform(post("/policies")
                        .header("X-API-Key", "integration-key")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"post-export-%s\",\"version\":1}".formatted(UUID.randomUUID())))
                .andExpect(status().isCreated());
        String secondResponse = mockMvc.perform(post("/admin/exports/audit")
                        .header("X-API-Key", "integration-key")
                        .param("date", date.toString()))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        String objectKey = objectMapper.readTree(firstResponse).get("objectKey").asText();
        int firstRecordCount = objectMapper.readTree(firstResponse).get("recordCount").asInt();
        int secondRecordCount = objectMapper.readTree(secondResponse).get("recordCount").asInt();
        String jsonLines = s3Client.getObjectAsBytes(GetObjectRequest.builder()
                        .bucket(BUCKET_NAME)
                        .key(objectKey)
                        .build())
                .asUtf8String();
        List<JsonNode> parsed = jsonLines.lines()
                .filter(line -> !line.isBlank())
                .map(objectMapper::readTree)
                .toList();

        assertThat(secondRecordCount).isGreaterThan(firstRecordCount);
        assertThat(parsed).hasSize(secondRecordCount).allSatisfy(line -> {
            assertThat(line.get("id").asText()).isNotBlank();
            assertThat(line.get("eventType").asText()).isNotBlank();
            assertThat(line.get("occurredAt").asText()).isNotBlank();
        });
        assertThat(s3Client.listObjectsV2(ListObjectsV2Request.builder()
                        .bucket(BUCKET_NAME)
                        .prefix("audit/dt=" + date + "/")
                        .build())
                .contents()).hasSize(1);
    }

    @Test
    @Order(4)
    void exportsLedgerEntriesToS3AndReconcilesThemWithStoredBalances() throws Exception {
        String policyResponse = mockMvc.perform(post("/policies")
                        .header("X-API-Key", "integration-key")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"reconciliation-%s\",\"version\":1}"
                                .formatted(UUID.randomUUID())))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        String policyId = objectMapper.readTree(policyResponse).get("id").asText();
        mockMvc.perform(post("/policies/{id}/rules", policyId)
                        .header("X-API-Key", "integration-key")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"toolNameGlob":"ledger.transfer","riskTier":"MEDIUM",
                                 "effect":"ALLOW","precedence":10,"currency":"USD"}
                                """))
                .andExpect(status().isCreated());

        String sourceId = createAccount("USD");
        String destinationId = createAccount("USD");
        mockMvc.perform(post("/accounts/{id}/deposits", sourceId)
                        .header("X-API-Key", "integration-key")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"amountMinor\":2000}"))
                .andExpect(status().isOk());
        mockMvc.perform(post("/transfers")
                        .header("X-API-Key", "integration-key")
                        .header("Idempotency-Key", "reconciliation-transfer-" + UUID.randomUUID())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"fromAccountId":"%s","toAccountId":"%s",
                                 "amountMinor":500,"currency":"USD","initiatedBy":"reconciler"}
                                """.formatted(sourceId, destinationId)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.state").value("POSTED"));

        LocalDate date = LocalDate.now(ZoneOffset.UTC);
        String response = mockMvc.perform(post("/admin/reconciliation")
                        .header("X-API-Key", "integration-key")
                        .param("date", date.toString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("MATCHED"))
                .andExpect(jsonPath("$.databaseRowCount").value(4))
                .andExpect(jsonPath("$.exportRowCount").value(4))
                .andReturn().getResponse().getContentAsString();

        String entryObjectKey = objectMapper.readTree(response).get("entryObjectKey").asText();
        String jsonLines = s3Client.getObjectAsBytes(GetObjectRequest.builder()
                        .bucket(BUCKET_NAME)
                        .key(entryObjectKey)
                        .build())
                .asUtf8String();
        assertThat(jsonLines.lines()).hasSize(4).allSatisfy(line ->
                assertThat(line).contains("\"currency\":\"USD\"", "\"postingId\""));
        mockMvc.perform(get("/admin/reconciliation/latest")
                        .header("X-API-Key", "integration-key"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("MATCHED"))
                .andExpect(jsonPath("$.entryObjectKey").value(entryObjectKey));
    }

    private String createAccount(String currency) throws Exception {
        String response = mockMvc.perform(post("/accounts")
                        .header("X-API-Key", "integration-key")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"currency\":\"%s\"}".formatted(currency)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response).get("id").asText();
    }

    private CreatedApproval createApprovalRequiredDecision() throws Exception {
        String policyName = "aws-policy-" + UUID.randomUUID();
        String policyResponse = mockMvc.perform(post("/policies")
                        .header("X-API-Key", "integration-key")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"%s\",\"version\":1}".formatted(policyName)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        String policyId = objectMapper.readTree(policyResponse).get("id").asText();
        mockMvc.perform(post("/policies/{id}/rules", policyId)
                        .header("X-API-Key", "integration-key")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"toolNameGlob":"fs.*","riskTier":"HIGH",
                                 "effect":"REQUIRE_APPROVAL","precedence":10}
                                """))
                .andExpect(status().isCreated());

        String response = mockMvc.perform(post("/decisions")
                        .header("X-API-Key", "integration-key")
                        .header("Idempotency-Key", "aws-decision-" + UUID.randomUUID())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"policyId":"%s","agentId":"agent-1","toolName":"fs.write",
                                 "arguments":{"path":"/sandbox/report.txt"},"riskTier":"HIGH"}
                                """.formatted(policyId)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.effect").value("REQUIRE_APPROVAL"))
                .andReturn().getResponse().getContentAsString();
        outboxRelay.relayOnce();
        JsonNode body = objectMapper.readTree(response);
        return new CreatedApproval(
                UUID.fromString(body.get("approvalId").asText()),
                UUID.fromString(body.get("id").asText()));
    }

    private String queueUrl() {
        return sqsClient.getQueueUrl(GetQueueUrlRequest.builder().queueName(QUEUE_NAME).build())
                .queueUrl();
    }

    private record CreatedApproval(UUID approvalId, UUID decisionId) {
    }
}
