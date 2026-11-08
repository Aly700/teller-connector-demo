package dev.affan.teller.domain;

import java.time.Clock;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TransferSettlementService implements ApprovalLifecycleListener {

    private final TransferStore transfers;
    private final AccountStore accounts;
    private final EntryStore entries;
    private final AuditService auditService;
    private final Clock clock;

    public TransferSettlementService(
            TransferStore transfers,
            AccountStore accounts,
            EntryStore entries,
            AuditService auditService,
            Clock clock) {
        this.transfers = transfers;
        this.accounts = accounts;
        this.entries = entries;
        this.auditService = auditService;
        this.clock = clock;
    }

    @Override
    @Transactional
    public void approved(UUID decisionId) {
        transfers.findLockedTransferByDecisionId(decisionId).ifPresent(transfer -> {
            if (transfer.getState() != TransferState.HELD) {
                throw new InvalidApprovalTransitionException("linked transfer is no longer held");
            }
            Money money = Money.of(transfer.getAmountMinor(), transfer.getCurrency());
            List<Account> locked = lockAccounts(transfer);
            Account source = accountWithId(locked, transfer.getFromAccountId());
            Account destination = accountWithId(locked, transfer.getToAccountId());
            source.postReservedDebit(money);
            destination.postCredit(money);
            transfer.post(clock.instant());
            writeEntries(transfer, source, destination, money);
            auditService.append(
                    AuditEventType.TRANSFER_POSTED,
                    "TRANSFER",
                    transfer.getId(),
                    Map.of("decisionId", decisionId, "approvalId", transfer.getApprovalId()));
        });
    }

    @Override
    @Transactional
    public void rejected(UUID decisionId, String reasonCode) {
        transfers.findLockedTransferByDecisionId(decisionId).ifPresent(transfer -> {
            if (transfer.getState() != TransferState.HELD) {
                return;
            }
            Money money = Money.of(transfer.getAmountMinor(), transfer.getCurrency());
            Account source = accounts.findLockedAccountById(transfer.getFromAccountId())
                    .orElseThrow(() -> new ResourceNotFoundException("account", transfer.getFromAccountId()));
            source.release(money);
            transfer.reverse(reasonCode, clock.instant());
            auditService.append(
                    AuditEventType.TRANSFER_REVERSED,
                    "TRANSFER",
                    transfer.getId(),
                    Map.of(
                            "decisionId", decisionId,
                            "approvalId", transfer.getApprovalId(),
                            "reasonCode", reasonCode));
        });
    }

    private List<Account> lockAccounts(Transfer transfer) {
        return List.of(transfer.getFromAccountId(), transfer.getToAccountId()).stream()
                .sorted(Comparator.naturalOrder())
                .map(id -> accounts.findLockedAccountById(id)
                        .orElseThrow(() -> new ResourceNotFoundException("account", id)))
                .toList();
    }

    private void writeEntries(
            Transfer transfer,
            Account source,
            Account destination,
            Money money) {
        Instant now = clock.instant();
        UUID postingId = UUID.randomUUID();
        entries.storeEntries(List.of(
                Entry.create(
                        UUID.randomUUID(),
                        postingId,
                        transfer.getId(),
                        source.getId(),
                        EntryDirection.DEBIT,
                        money.minorUnits(),
                        money.currency(),
                        now),
                Entry.create(
                        UUID.randomUUID(),
                        postingId,
                        transfer.getId(),
                        destination.getId(),
                        EntryDirection.CREDIT,
                        money.minorUnits(),
                        money.currency(),
                        now)));
    }

    private static Account accountWithId(List<Account> accounts, UUID id) {
        return accounts.stream().filter(account -> account.getId().equals(id)).findFirst().orElseThrow();
    }
}
