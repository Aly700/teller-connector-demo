package dev.affan.teller.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import dev.affan.teller.TestcontainersConfiguration;
import dev.affan.teller.domain.Approval;
import dev.affan.teller.domain.ApprovalRepository;
import dev.affan.teller.domain.ApprovalStatus;
import dev.affan.teller.domain.AuditEventType;
import dev.affan.teller.domain.AuditRecordRepository;
import dev.affan.teller.sqs.ApprovalMessageCodec;
import dev.affan.teller.sqs.OutboxRepository;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.junit.jupiter.Testcontainers;
import tools.jackson.databind.ObjectMapper;

@Testcontainers(disabledWithoutDocker = true)
@Import(TestcontainersConfiguration.class)
@SpringBootTest(properties = {
        "teller.api-key=integration-key",
        "teller.aws.enabled=false"
})
@AutoConfigureMockMvc
class ApiIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired private ObjectMapper objectMapper;
    @Autowired private ApprovalRepository approvals;
    @Autowired private AuditRecordRepository auditRecords;
    @Autowired private OutboxRepository outbox;
    @Autowired private ApprovalMessageCodec approvalMessageCodec;

    @Test
    void requiresAnApiKey() throws Exception {
        mockMvc.perform(get("/audit")
                        .param("from", "2026-08-28T00:00:00Z")
                        .param("to", "2026-08-29T00:00:00Z"))
                .andExpect(status().isUnauthorized())
                .andExpect(content().contentType(MediaType.APPLICATION_PROBLEM_JSON));
    }

    @Test
    void returnsAProblemForInvalidInput() throws Exception {
        mockMvc.perform(post("/policies")
                        .header("X-API-Key", "integration-key")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"\",\"version\":0}"))
                .andExpect(status().isBadRequest())
                .andExpect(content().contentType(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.title").value("Validation failed"));
    }

    @Test
    void evaluatesFirstMatchingRuleAndCreatesAnApproval() throws Exception {
        String policyId = createPolicy("review-policy");
        addRule(policyId, 10, "fs.*", "REQUIRE_APPROVAL");
        addRule(policyId, 20, "*", "ALLOW");

        String decisionBody = mockMvc.perform(post("/decisions")
                        .header("X-API-Key", "integration-key")
                        .header("Idempotency-Key", "api-decision-" + java.util.UUID.randomUUID())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"policyId":"%s","agentId":"agent-1","toolName":"fs.write",
                                 "arguments":{"path":"/sandbox/report.txt"},"riskTier":"MEDIUM"}
                                """.formatted(policyId)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.effect").value("REQUIRE_APPROVAL"))
                .andExpect(jsonPath("$.matchedRuleId").isNotEmpty())
                .andExpect(jsonPath("$.approvalId").isNotEmpty())
                .andReturn().getResponse().getContentAsString();

        String approvalId = jsonString(decisionBody, "approvalId");
        String decisionId = jsonString(decisionBody, "id");
        UUID approvalUuid = UUID.fromString(approvalId);
        Approval committedApproval = approvals.findById(approvalUuid).orElseThrow();
        assertThat(committedApproval.getStatus()).isEqualTo(ApprovalStatus.PENDING);
        assertThat(committedApproval.getDecisionId()).isEqualTo(UUID.fromString(decisionId));
        assertThat(committedApproval.getExpiresAt()).isAfter(committedApproval.getCreatedAt());
        assertThat(outbox.findAll())
                .filteredOn(row -> row.getAggregateId().equals(approvalUuid))
                .singleElement()
                .satisfies(row -> assertThat(approvalMessageCodec.decode(row.getPayload()).approvalId())
                        .isEqualTo(approvalUuid));
        assertThat(auditRecords.findAll())
                .filteredOn(record -> record.getAggregateId().equals(approvalUuid))
                .filteredOn(record -> record.getEventType() == AuditEventType.APPROVAL_CREATED)
                .hasSize(1);

        mockMvc.perform(get("/approvals")
                        .header("X-API-Key", "integration-key")
                        .param("status", "PENDING"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.id == '%s')]".formatted(approvalId)).exists());

        mockMvc.perform(post("/approvals/{id}/approve", approvalId)
                        .header("X-API-Key", "integration-key")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"decidedBy":"reviewer-1","reason":"Ticket and payload verified"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("APPROVED"))
                .andExpect(jsonPath("$.reason").value("Ticket and payload verified"));

        assertThat(approvals.findById(approvalUuid).orElseThrow().getReason())
                .isEqualTo("Ticket and payload verified");
        assertThat(auditRecords.findAll())
                .filteredOn(record -> record.getAggregateId().equals(approvalUuid))
                .filteredOn(record -> record.getEventType() == AuditEventType.APPROVAL_APPROVED)
                .singleElement()
                .satisfies(record -> assertThat(record.getDetails()).contains("Ticket and payload verified"));

        mockMvc.perform(get("/decisions/{id}", decisionId)
                        .header("X-API-Key", "integration-key"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.toolName").value("fs.write"));
    }

    @Test
    void queriesAppendOnlyAuditRecordsByTimeRange() throws Exception {
        createPolicy("audited-policy");

        mockMvc.perform(get("/audit")
                        .header("X-API-Key", "integration-key")
                        .param("from", "2026-01-01T00:00:00Z")
                        .param("to", "2027-01-01T00:00:00Z"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.eventType == 'POLICY_CREATED')]").exists());
    }

    private String createPolicy(String name) throws Exception {
        String body = mockMvc.perform(post("/policies")
                        .header("X-API-Key", "integration-key")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"%s\",\"version\":1}".formatted(name)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return jsonString(body, "id");
    }

    private void addRule(String policyId, int precedence, String glob, String effect) throws Exception {
        mockMvc.perform(post("/policies/{id}/rules", policyId)
                        .header("X-API-Key", "integration-key")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"toolNameGlob":"%s","effect":"%s","precedence":%d}
                                """.formatted(glob, effect, precedence)))
                .andExpect(status().isCreated());
    }

    private String jsonString(String json, String field) {
        return objectMapper.readTree(json).get(field).asString();
    }
}
