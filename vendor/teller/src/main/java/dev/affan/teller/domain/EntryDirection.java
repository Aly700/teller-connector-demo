package dev.affan.teller.domain;

public enum EntryDirection {
    DEBIT(-1),
    CREDIT(1);

    private final int sign;

    EntryDirection(int sign) {
        this.sign = sign;
    }

    public long signed(long amountMinor) {
        return Math.multiplyExact(sign, amountMinor);
    }
}
