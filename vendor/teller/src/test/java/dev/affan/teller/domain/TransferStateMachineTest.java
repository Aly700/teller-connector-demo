package dev.affan.teller.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class TransferStateMachineTest {

    private static final Instant CREATED = Instant.parse("2026-08-29T00:00:00Z");
    private static final Instant LATER = CREATED.plusSeconds(5);

    @Test
    void authorizedTransferCanPostAndThenReverse() {
        Transfer transfer = pending();

        transfer.authorize();
        transfer.post(LATER);
        transfer.reverse("REQUESTED", LATER.plusSeconds(1));

        assertThat(transfer.getState()).isEqualTo(TransferState.REVERSED);
        assertThat(transfer.getPostedAt()).isEqualTo(LATER);
        assertThat(transfer.getReversedAt()).isEqualTo(LATER.plusSeconds(1));
        assertThat(transfer.getReasonCode()).isEqualTo("REQUESTED");
    }

    @Test
    void heldTransferCanPostOrReverse() {
        UUID approvalId = UUID.randomUUID();
        Transfer approved = pending();
        Transfer denied = pending();

        approved.hold(approvalId);
        approved.post(LATER);
        denied.hold(UUID.randomUUID());
        denied.reverse("APPROVAL_DENIED", LATER);

        assertThat(approved.getState()).isEqualTo(TransferState.POSTED);
        assertThat(approved.getApprovalId()).isEqualTo(approvalId);
        assertThat(denied.getState()).isEqualTo(TransferState.REVERSED);
    }

    @Test
    void pendingTransferCanBeDeniedButTerminalTransfersCannotMoveAgain() {
        Transfer transfer = pending();
        transfer.deny("POLICY_DENIED");

        assertThat(transfer.getState()).isEqualTo(TransferState.DENIED);
        assertThatThrownBy(transfer::authorize)
                .isInstanceOf(InvalidTransferTransitionException.class);
    }

    @Test
    void postingDirectlyFromPendingIsRejected() {
        assertThatThrownBy(() -> pending().post(LATER))
                .isInstanceOf(InvalidTransferTransitionException.class);
    }

    private static Transfer pending() {
        return Transfer.pending(
                UUID.randomUUID(),
                "idem-" + UUID.randomUUID(),
                UUID.randomUUID(),
                UUID.randomUUID(),
                Money.of(2_500, "USD"),
                UUID.randomUUID(),
                CREATED);
    }
}
