package dev.affan.teller.domain;

public final class InvalidApprovalTransitionException extends RuntimeException {

    public InvalidApprovalTransitionException(String message) {
        super(message);
    }
}
