package dev.affan.teller.sqs;

import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

@Component
public class ApprovalMessageCodec {

    private final ObjectMapper objectMapper;

    public ApprovalMessageCodec(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public String encode(ApprovalMessage message) {
        return objectMapper.writeValueAsString(message);
    }

    public ApprovalMessage decode(String json) {
        return objectMapper.readValue(json, ApprovalMessage.class);
    }
}
