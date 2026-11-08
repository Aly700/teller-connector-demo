package dev.affan.teller.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class AccountLedgerTest {

    private static final Instant NOW = Instant.parse("2026-08-29T00:00:00Z");

    @Test
    void reservationBecomesAPostedDebitWithoutDoubleSubtractingAvailableBalance() {
        Account source = Account.open(UUID.randomUUID(), "USD", NOW);
        Account destination = Account.open(UUID.randomUUID(), "USD", NOW);
        Money funding = Money.of(10_000, "USD");
        Money payment = Money.of(7_000, "USD");

        source.deposit(funding);
        source.reserve(payment);
        source.postReservedDebit(payment);
        destination.postCredit(payment);

        assertThat(source.getLedgerBalanceMinor()).isEqualTo(3_000);
        assertThat(source.getAvailableBalanceMinor()).isEqualTo(3_000);
        assertThat(destination.getLedgerBalanceMinor()).isEqualTo(7_000);
        assertThat(destination.getAvailableBalanceMinor()).isEqualTo(7_000);
    }

    @Test
    void releasingAReservationRestoresOnlyAvailableBalance() {
        Account account = Account.open(UUID.randomUUID(), "USD", NOW);
        account.deposit(Money.of(5_000, "USD"));
        account.reserve(Money.of(2_000, "USD"));

        account.release(Money.of(2_000, "USD"));

        assertThat(account.getLedgerBalanceMinor()).isEqualTo(5_000);
        assertThat(account.getAvailableBalanceMinor()).isEqualTo(5_000);
    }

    @Test
    void cannotReserveMoreThanTheAvailableBalance() {
        Account account = Account.open(UUID.randomUUID(), "USD", NOW);
        account.deposit(Money.of(1_000, "USD"));

        assertThatThrownBy(() -> account.reserve(Money.of(1_001, "USD")))
                .isInstanceOf(InsufficientFundsException.class);
    }

    @Test
    void cannotPostAReservedDebitWhenNoReservationExists() {
        Account account = Account.open(UUID.randomUUID(), "USD", NOW);
        account.deposit(Money.of(1_000, "USD"));

        assertThatThrownBy(() -> account.postReservedDebit(Money.of(500, "USD")))
                .isInstanceOf(IllegalStateException.class);
        assertThat(account.getLedgerBalanceMinor()).isEqualTo(1_000);
        assertThat(account.getAvailableBalanceMinor()).isEqualTo(1_000);
    }

    @Test
    void failedOverReleaseLeavesBalancesUnchanged() {
        Account account = Account.open(UUID.randomUUID(), "USD", NOW);
        account.deposit(Money.of(1_000, "USD"));
        account.reserve(Money.of(200, "USD"));

        assertThatThrownBy(() -> account.release(Money.of(201, "USD")))
                .isInstanceOf(IllegalStateException.class);
        assertThat(account.getLedgerBalanceMinor()).isEqualTo(1_000);
        assertThat(account.getAvailableBalanceMinor()).isEqualTo(800);
    }

    @Test
    void debitAndCreditEntriesHaveAZeroSignedTotal() {
        UUID transferId = UUID.randomUUID();
        long amount = 4_250;
        Entry debit = Entry.create(
                UUID.randomUUID(), transferId, transferId, UUID.randomUUID(),
                EntryDirection.DEBIT, amount, "USD", NOW);
        Entry credit = Entry.create(
                UUID.randomUUID(), transferId, transferId, UUID.randomUUID(),
                EntryDirection.CREDIT, amount, "USD", NOW);

        assertThat(LedgerArithmetic.signedTotal(List.of(debit, credit))).isZero();
        assertThat(LedgerArithmetic.isBalanced(List.of(debit, credit))).isTrue();
        assertThat(LedgerArithmetic.isBalanced(List.of(debit))).isFalse();
    }
}
