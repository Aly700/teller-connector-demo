package dev.affan.teller.web;

import static org.assertj.core.api.Assertions.assertThat;

import dev.affan.teller.domain.ApprovalQueueService.ApprovalTransferDetails;
import dev.affan.teller.domain.TransferState;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class ApprovalControllerResponseTest {

    @Test
    void serializesLongMinorUnitsAsAnExactDecimalStringForJavaScriptClients() {
        ApprovalTransferDetails details = new ApprovalTransferDetails(
                UUID.randomUUID(),
                Long.MAX_VALUE,
                "USD",
                UUID.randomUUID(),
                UUID.randomUUID(),
                TransferState.HELD,
                UUID.randomUUID(),
                UUID.randomUUID(),
                Instant.parse("2026-08-29T15:00:00Z"));

        ApprovalController.ApprovalTransferResponse response =
                ApprovalController.ApprovalTransferResponse.from(details);

        assertThat(response.amountMinor()).isEqualTo("9223372036854775807");
    }
}
