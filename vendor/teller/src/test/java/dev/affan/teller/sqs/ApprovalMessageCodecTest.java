package dev.affan.teller.sqs;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

class ApprovalMessageCodecTest {

    private final ApprovalMessageCodec codec = new ApprovalMessageCodec(new ObjectMapper());

    @Test
    void roundTripsAnApprovalMessage() {
        ApprovalMessage message = new ApprovalMessage(
                UUID.fromString("9ef0cc83-411f-4b24-a39a-7c8db52ae2d0"),
                UUID.fromString("16c9f884-412c-4dd9-97e3-8d091319ec41"),
                UUID.fromString("9dac1207-2588-4c61-9700-0208fb41cc63"),
                Instant.parse("2026-08-28T13:00:00Z"));

        ApprovalMessage decoded = codec.decode(codec.encode(message));

        assertThat(decoded).isEqualTo(message);
    }

    @Test
    void usesStableCamelCaseFieldNames() {
        ApprovalMessage message = new ApprovalMessage(
                UUID.randomUUID(),
                UUID.randomUUID(),
                UUID.randomUUID(),
                Instant.parse("2026-08-28T13:00:00Z"));

        String json = codec.encode(message);

        assertThat(json).contains("\"messageId\"", "\"approvalId\"", "\"decisionId\"", "\"expiresAt\"");
    }
}
