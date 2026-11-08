# ADR 0001: Minor units and currency

## Context

Teller is a simulated payments core, but its arithmetic still has to be exact. Binary floating-point values cannot represent every decimal amount exactly, and rounding at different layers can change a balance. An amount also has no clear meaning without its currency.

## Decision

Represent every amount as a Java `long` count of minor units paired with a three-letter ISO-4217 currency code. Store the amount in PostgreSQL as `BIGINT` and the currency as `VARCHAR(3)`. Validate and normalize the currency at the domain boundary.

Never use `float` or `double` for ledger, reservation, policy, API, export, or reconciliation arithmetic. Use exact integer operations, including overflow-checking operations when balances change. JSON intended for JavaScript may serialize a minor-unit value as a decimal string so values above JavaScript's safe-integer limit remain exact.

## Consequences

- Equality, addition, subtraction, amount bounds, and reconciliation use exact integer comparisons.
- Code must reject arithmetic across different currencies instead of converting implicitly.
- Currency-specific display precision belongs at the presentation boundary; the stored value remains minor units.
- Values are limited to the signed 64-bit range, and overflow is an error rather than a wrapped balance.
- Teller does not perform foreign-exchange conversion.
