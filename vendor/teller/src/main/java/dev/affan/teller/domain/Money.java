package dev.affan.teller.domain;

import java.util.Currency;
import java.util.Locale;
import java.util.Objects;

public record Money(long minorUnits, String currency) {

    public Money {
        if (minorUnits < 0) {
            throw new IllegalArgumentException("minorUnits must not be negative");
        }
        if (currency == null || currency.isBlank()) {
            throw new IllegalArgumentException("currency must not be blank");
        }
        currency = currency.toUpperCase(Locale.ROOT);
        try {
            Currency.getInstance(currency);
        } catch (IllegalArgumentException exception) {
            throw new IllegalArgumentException("currency must be an ISO-4217 code", exception);
        }
    }

    public static Money of(long minorUnits, String currency) {
        return new Money(minorUnits, currency);
    }

    public void requireSameCurrency(String expectedCurrency) {
        if (!currency.equals(Objects.requireNonNull(expectedCurrency, "expectedCurrency"))) {
            throw new IllegalArgumentException("currency does not match account currency");
        }
    }
}
