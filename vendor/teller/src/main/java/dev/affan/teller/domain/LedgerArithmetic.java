package dev.affan.teller.domain;

import java.util.Collection;
import java.util.Objects;

public final class LedgerArithmetic {

    private LedgerArithmetic() {
    }

    public static long signedTotal(Collection<? extends Entry> entries) {
        Objects.requireNonNull(entries, "entries");
        long total = 0;
        for (Entry entry : entries) {
            total = Math.addExact(total, Objects.requireNonNull(entry, "entry").signedAmountMinor());
        }
        return total;
    }

    public static boolean isBalanced(Collection<? extends Entry> entries) {
        return entries != null && entries.size() >= 2 && signedTotal(entries) == 0;
    }
}
