package dev.affan.teller.domain;

public final class ConflictException extends RuntimeException {

    public ConflictException(String message) {
        super(message);
    }
}
