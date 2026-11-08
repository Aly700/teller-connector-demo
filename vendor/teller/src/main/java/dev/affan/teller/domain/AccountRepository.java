package dev.affan.teller.domain;

import jakarta.persistence.LockModeType;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface AccountRepository extends JpaRepository<Account, UUID>, AccountStore {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select account from Account account where account.id = :id")
    Optional<Account> findLockedById(@Param("id") UUID id);

    @Override
    default Account storeAccount(Account account) {
        return save(account);
    }

    @Override
    default Optional<Account> findAccountById(UUID id) {
        return findById(id);
    }

    @Override
    default Optional<Account> findLockedAccountById(UUID id) {
        return findLockedById(id);
    }

    @Override
    default java.util.List<Account> findAllAccounts() {
        return findAll();
    }
}
