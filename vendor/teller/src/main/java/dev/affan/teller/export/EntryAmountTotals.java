package dev.affan.teller.export;

import dev.affan.teller.domain.EntryDirection;

public record EntryAmountTotals(
        int debitRows,
        int creditRows,
        long debitMinor,
        long creditMinor) {

    public EntryAmountTotals add(EntryDirection direction, long amountMinor) {
        return direction == EntryDirection.DEBIT
                ? new EntryAmountTotals(
                        Math.addExact(debitRows, 1),
                        creditRows,
                        Math.addExact(debitMinor, amountMinor),
                        creditMinor)
                : new EntryAmountTotals(
                        debitRows,
                        Math.addExact(creditRows, 1),
                        debitMinor,
                        Math.addExact(creditMinor, amountMinor));
    }

    public static EntryAmountTotals zero() {
        return new EntryAmountTotals(0, 0, 0, 0);
    }
}
