package dev.affan.teller.web;

import dev.affan.teller.domain.Decision;
import dev.affan.teller.domain.DecisionOutcome;
import dev.affan.teller.domain.DecisionService;
import dev.affan.teller.domain.Effect;
import dev.affan.teller.domain.EvaluateDecisionCommand;
import dev.affan.teller.domain.IdempotencyService;
import dev.affan.teller.domain.IdempotencyService.StoredResponse;
import dev.affan.teller.domain.RiskTier;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.net.URI;
import java.time.Instant;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@RestController
@RequestMapping("/decisions")
public class DecisionController {

    private final DecisionService decisionService;
    private final IdempotencyService idempotencyService;
    private final ObjectMapper objectMapper;

    public DecisionController(
            DecisionService decisionService,
            IdempotencyService idempotencyService,
            ObjectMapper objectMapper) {
        this.decisionService = decisionService;
        this.idempotencyService = idempotencyService;
        this.objectMapper = objectMapper;
    }

    @PostMapping
    ResponseEntity<String> evaluate(
            @RequestAttribute(IdempotencyKeyFilter.REQUEST_ATTRIBUTE) String idempotencyKey,
            @Valid @RequestBody EvaluateDecisionRequest request) {
        JsonNode canonicalRequest = objectMapper.valueToTree(request);
        StoredResponse stored = idempotencyService.execute(
                idempotencyKey,
                idempotencyService.requestHash(canonicalRequest),
                () -> evaluateOnce(request));
        ResponseEntity.BodyBuilder response = ResponseEntity.status(stored.statusCode())
                .contentType(MediaType.APPLICATION_JSON);
        if (stored.statusCode() == 201) {
            String id = objectMapper.readTree(stored.responseBody()).get("id").asString();
            response.location(URI.create("/decisions/" + id));
        }
        return response.body(stored.responseBody());
    }

    private StoredResponse evaluateOnce(EvaluateDecisionRequest request) {
        DecisionOutcome outcome = decisionService.evaluate(request.toCommand());
        DecisionResponse response = DecisionResponse.from(
                outcome.decision(),
                outcome.approval() == null ? null : outcome.approval().getId(),
                objectMapper);
        return new StoredResponse(201, objectMapper.writeValueAsString(response));
    }

    @GetMapping("/{id}")
    DecisionResponse get(@PathVariable UUID id) {
        return DecisionResponse.from(decisionService.get(id), null, objectMapper);
    }

    public record EvaluateDecisionRequest(
            @NotNull UUID policyId,
            @NotBlank @Size(max = 160) String agentId,
            @NotBlank @Size(max = 255) String toolName,
            @NotNull JsonNode arguments,
            @NotNull RiskTier riskTier) {

        EvaluateDecisionCommand toCommand() {
            return new EvaluateDecisionCommand(
                    policyId,
                    agentId,
                    toolName,
                    arguments.toString(),
                    riskTier);
        }
    }

    public record DecisionResponse(
            UUID id,
            UUID policyId,
            int policyVersion,
            String agentId,
            String toolName,
            JsonNode arguments,
            RiskTier riskTier,
            UUID matchedRuleId,
            Effect effect,
            Instant timestamp,
            UUID approvalId) {

        static DecisionResponse from(Decision decision, UUID approvalId, ObjectMapper objectMapper) {
            return new DecisionResponse(
                    decision.getId(),
                    decision.getPolicyId(),
                    decision.getPolicyVersion(),
                    decision.getAgentId(),
                    decision.getToolName(),
                    objectMapper.readTree(decision.getArguments()),
                    decision.getRiskTier(),
                    decision.getMatchedRuleId(),
                    decision.getEffect(),
                    decision.getDecidedAt(),
                    approvalId);
        }
    }
}
