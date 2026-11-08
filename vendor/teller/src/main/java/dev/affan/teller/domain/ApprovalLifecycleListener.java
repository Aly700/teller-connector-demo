package dev.affan.teller.domain;

import java.util.UUID;

public interface ApprovalLifecycleListener {

    ApprovalLifecycleListener NOOP = new ApprovalLifecycleListener() {
        @Override
        public void approved(UUID decisionId) {
        }

        @Override
        public void rejected(UUID decisionId, String reasonCode) {
        }
    };

    void approved(UUID decisionId);

    void rejected(UUID decisionId, String reasonCode);
}
