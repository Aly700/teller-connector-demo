package dev.affan.teller.domain;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface AccountStore {

    Account storeAccount(Account account);

    Optional<Account> findAccountById(UUID id);

    Optional<Account> findLockedAccountById(UUID id);

    List<Account> findAllAccounts();
}
