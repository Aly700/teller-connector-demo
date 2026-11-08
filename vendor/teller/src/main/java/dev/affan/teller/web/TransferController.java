package dev.affan.teller.web;

import dev.affan.teller.domain.CreateTransferCommand;
import dev.affan.teller.domain.IdempotencyService;
import dev.affan.teller.domain.IdempotencyService.StoredResponse;
import dev.affan.teller.domain.Money;
import dev.affan.teller.domain.Transfer;
import dev.affan.teller.domain.TransferService;
import dev.affan.teller.domain.TransferState;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.net.URI;
import java.time.Instant;
import java.util.UUID;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@RestController
@RequestMapping("/transfers")
public class TransferController {

    private final TransferService transferService;
    private final IdempotencyService idempotencyService;
    private final ObjectMapper objectMapper;

    public TransferController(
            TransferService transferService,
            IdempotencyService idempotencyService,
            ObjectMapper objectMapper) {
        this.transferService = transferService;
        this.idempotencyService = idempotencyService;
        this.objectMapper = objectMapper;
    }

    @PostMapping
    ResponseEntity<String> create(
            @RequestAttribute(IdempotencyKeyFilter.REQUEST_ATTRIBUTE) String idempotencyKey,
            @Valid @RequestBody CreateTransferRequest request) {
        JsonNode canonicalRequest = objectMapper.valueToTree(request);
        StoredResponse stored = idempotencyService.execute(
                idempotencyKey,
                idempotencyService.requestHash(canonicalRequest),
                () -> createOnce(idempotencyKey, request));
        ResponseEntity.BodyBuilder response = ResponseEntity.status(stored.statusCode())
                .contentType(MediaType.APPLICATION_JSON);
        if (stored.statusCode() == 201) {
            String id = objectMapper.readTree(stored.responseBody()).get("id").asString();
            response.location(URI.create("/transfers/" + id));
        }
        return response.body(stored.responseBody());
    }

    private StoredResponse createOnce(String idempotencyKey, CreateTransferRequest request) {
        Transfer transfer = transferService.createTransfer(new CreateTransferCommand(
                idempotencyKey,
                request.fromAccountId(),
                request.toAccountId(),
                Money.of(request.amountMinor(), request.currency()),
                request.initiatedBy()));
        return new StoredResponse(201, objectMapper.writeValueAsString(TransferResponse.from(transfer)));
    }

    @GetMapping("/{id}")
    TransferResponse get(@PathVariable UUID id) {
        return TransferResponse.from(transferService.getTransfer(id));
    }

    @PostMapping("/{id}/reverse")
    TransferResponse reverse(
            @PathVariable UUID id,
            @Valid @RequestBody ReverseTransferRequest request) {
        return TransferResponse.from(transferService.reverse(id, request.reasonCode()));
    }

    public record CreateTransferRequest(
            @NotNull UUID fromAccountId,
            @NotNull UUID toAccountId,
            @Positive long amountMinor,
            @NotBlank @Size(min = 3, max = 3) String currency,
            @NotBlank @Size(max = 160) String initiatedBy) {
    }

    public record ReverseTransferRequest(@NotBlank @Size(max = 64) String reasonCode) {
    }

    public record TransferResponse(
            UUID id,
            UUID fromAccountId,
            UUID toAccountId,
            long amountMinor,
            String currency,
            TransferState state,
            String reasonCode,
            UUID decisionId,
            UUID approvalId,
            Instant createdAt,
            Instant postedAt,
            Instant reversedAt) {

        static TransferResponse from(Transfer transfer) {
            return new TransferResponse(
                    transfer.getId(),
                    transfer.getFromAccountId(),
                    transfer.getToAccountId(),
                    transfer.getAmountMinor(),
                    transfer.getCurrency(),
                    transfer.getState(),
                    transfer.getReasonCode(),
                    transfer.getDecisionId(),
                    transfer.getApprovalId(),
                    transfer.getCreatedAt(),
                    transfer.getPostedAt(),
                    transfer.getReversedAt());
        }
    }
}
