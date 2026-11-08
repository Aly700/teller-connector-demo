package dev.affan.teller.domain;

public enum TransferState {
    PENDING,
    AUTHORIZED,
    HELD,
    DENIED,
    POSTED,
    REVERSED
}
