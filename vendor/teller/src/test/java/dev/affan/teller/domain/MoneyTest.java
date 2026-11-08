package dev.affan.teller.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class MoneyTest {

    @Test
    void representsMoneyOnlyAsMinorUnitsAndAnIsoCurrency() {
        Money money = Money.of(12_345, "usd");

        assertThat(money.minorUnits()).isEqualTo(12_345);
        assertThat(money.currency()).isEqualTo("USD");
    }

    @Test
    void rejectsNegativeAmountsAndUnknownCurrencies() {
        assertThatThrownBy(() -> Money.of(-1, "USD"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> Money.of(1, "NOT-A-CURRENCY"))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
