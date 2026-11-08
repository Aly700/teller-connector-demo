package dev.affan.teller.domain;

public class InsufficientFundsException extends RuntimeException {

    public InsufficientFundsException() {
        super("account has insufficient available funds");
    }
}
