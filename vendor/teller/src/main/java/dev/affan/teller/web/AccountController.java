package dev.affan.teller.web;

import dev.affan.teller.domain.Account;
import dev.affan.teller.domain.AccountStatus;
import dev.affan.teller.domain.Money;
import dev.affan.teller.domain.TransferService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.net.URI;
import java.time.Instant;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/accounts")
public class AccountController {

    private final TransferService transferService;

    public AccountController(TransferService transferService) {
        this.transferService = transferService;
    }

    @PostMapping
    ResponseEntity<AccountResponse> create(@Valid @RequestBody CreateAccountRequest request) {
        Account account = transferService.createAccount(request.currency());
        return ResponseEntity.created(URI.create("/accounts/" + account.getId()))
                .body(AccountResponse.from(account));
    }

    @GetMapping("/{id}")
    AccountResponse get(@PathVariable UUID id) {
        return AccountResponse.from(transferService.getAccount(id));
    }

    @PostMapping("/{id}/deposits")
    AccountResponse deposit(
            @PathVariable UUID id,
            @Valid @RequestBody DepositRequest request) {
        Account account = transferService.getAccount(id);
        return AccountResponse.from(transferService.deposit(
                id,
                Money.of(request.amountMinor(), account.getCurrency())));
    }

    public record CreateAccountRequest(@NotBlank @Size(min = 3, max = 3) String currency) {
    }

    public record DepositRequest(@Positive long amountMinor) {
    }

    public record AccountResponse(
            UUID id,
            String currency,
            AccountStatus status,
            long ledgerBalanceMinor,
            long availableBalanceMinor,
            long version,
            Instant createdAt) {

        static AccountResponse from(Account account) {
            return new AccountResponse(
                    account.getId(),
                    account.getCurrency(),
                    account.getStatus(),
                    account.getLedgerBalanceMinor(),
                    account.getAvailableBalanceMinor(),
                    account.getVersion(),
                    account.getCreatedAt());
        }
    }
}
