package dev.affan.teller.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

@Entity
@Table(name = "accounts")
public class Account {

    @Id
    private UUID id;

    @Column(nullable = false, length = 3, updatable = false)
    private String currency;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private AccountStatus status;

    @Column(name = "ledger_balance_minor", nullable = false)
    private long ledgerBalanceMinor;

    @Column(name = "available_balance_minor", nullable = false)
    private long availableBalanceMinor;

    @Version
    private long version;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected Account() {
    }

    private Account(UUID id, String currency, Instant createdAt) {
        this.id = Objects.requireNonNull(id, "id");
        this.currency = Money.of(0, currency).currency();
        this.status = AccountStatus.ACTIVE;
        this.createdAt = Objects.requireNonNull(createdAt, "createdAt");
    }

    public static Account open(UUID id, String currency, Instant createdAt) {
        return new Account(id, currency, createdAt);
    }

    public void deposit(Money money) {
        requireActive(money);
        ledgerBalanceMinor = Math.addExact(ledgerBalanceMinor, money.minorUnits());
        availableBalanceMinor = Math.addExact(availableBalanceMinor, money.minorUnits());
    }

    public void reserve(Money money) {
        requireActive(money);
        if (availableBalanceMinor < money.minorUnits()) {
            throw new InsufficientFundsException();
        }
        availableBalanceMinor = Math.subtractExact(availableBalanceMinor, money.minorUnits());
    }

    public void release(Money money) {
        requireActive(money);
        long releasedBalance = Math.addExact(availableBalanceMinor, money.minorUnits());
        if (releasedBalance > ledgerBalanceMinor) {
            throw new IllegalStateException("released amount exceeds account reservations");
        }
        availableBalanceMinor = releasedBalance;
    }

    public void postDebit(Money money) {
        reserve(money);
        postReservedDebit(money);
    }

    public void postReservedDebit(Money money) {
        requireActive(money);
        long reservedBalanceMinor = Math.subtractExact(ledgerBalanceMinor, availableBalanceMinor);
        if (reservedBalanceMinor < money.minorUnits()) {
            throw new IllegalStateException("posted amount exceeds account reservations");
        }
        if (ledgerBalanceMinor < money.minorUnits()) {
            throw new InsufficientFundsException();
        }
        ledgerBalanceMinor = Math.subtractExact(ledgerBalanceMinor, money.minorUnits());
    }

    public void postCredit(Money money) {
        deposit(money);
    }

    public void reversePostedDebit(Money money) {
        deposit(money);
    }

    public void reversePostedCredit(Money money) {
        postDebit(money);
    }

    private void requireActive(Money money) {
        Objects.requireNonNull(money, "money").requireSameCurrency(currency);
        if (status != AccountStatus.ACTIVE) {
            throw new ConflictException("account is not active");
        }
    }

    public UUID getId() { return id; }
    public String getCurrency() { return currency; }
    public AccountStatus getStatus() { return status; }
    public long getLedgerBalanceMinor() { return ledgerBalanceMinor; }
    public long getAvailableBalanceMinor() { return availableBalanceMinor; }
    public long getVersion() { return version; }
    public Instant getCreatedAt() { return createdAt; }
}
