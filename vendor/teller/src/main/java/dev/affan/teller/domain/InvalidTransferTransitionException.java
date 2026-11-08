package dev.affan.teller.domain;

public class InvalidTransferTransitionException extends RuntimeException {

    public InvalidTransferTransitionException(String message) {
        super(message);
    }
}
