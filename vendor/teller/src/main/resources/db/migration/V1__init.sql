CREATE TABLE policies (
    id UUID PRIMARY KEY,
    name VARCHAR(160) NOT NULL CHECK (length(trim(name)) > 0),
    version INTEGER NOT NULL CHECK (version > 0),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT uk_policies_name_version UNIQUE (name, version)
);

CREATE UNIQUE INDEX uk_policies_one_active ON policies(active) WHERE active;

CREATE TABLE rules (
    id UUID PRIMARY KEY,
    policy_id UUID NOT NULL REFERENCES policies(id),
    tool_name_glob VARCHAR(255) NOT NULL,
    argument_regex TEXT,
    agent_id VARCHAR(160),
    risk_tier VARCHAR(16),
    effect VARCHAR(32) NOT NULL,
    precedence INTEGER NOT NULL CHECK (precedence >= 0),
    amount_min_minor BIGINT CHECK (amount_min_minor >= 0),
    amount_max_minor BIGINT CHECK (amount_max_minor >= 0),
    currency VARCHAR(3) CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
    velocity_max INTEGER CHECK (velocity_max > 0),
    velocity_window_seconds BIGINT CHECK (velocity_window_seconds > 0),
    counterparty_allow UUID[] NOT NULL DEFAULT '{}'::uuid[],
    counterparty_deny UUID[] NOT NULL DEFAULT '{}'::uuid[],
    four_eyes_above_minor BIGINT CHECK (four_eyes_above_minor >= 0),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT ck_rules_amount_range CHECK (
        amount_min_minor IS NULL OR amount_max_minor IS NULL OR amount_min_minor <= amount_max_minor
    ),
    CONSTRAINT ck_rules_velocity_complete CHECK (
        (velocity_max IS NULL AND velocity_window_seconds IS NULL)
        OR (velocity_max IS NOT NULL AND velocity_window_seconds IS NOT NULL)
    ),
    CONSTRAINT ck_rules_risk_tier CHECK (
        risk_tier IS NULL OR risk_tier IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')
    ),
    CONSTRAINT ck_rules_effect CHECK (effect IN ('ALLOW', 'DENY', 'REQUIRE_APPROVAL')),
    CONSTRAINT uk_rules_policy_precedence UNIQUE (policy_id, precedence)
);

CREATE INDEX idx_rules_policy_order ON rules(policy_id, precedence, id);

CREATE TABLE decisions (
    id UUID PRIMARY KEY,
    policy_id UUID NOT NULL REFERENCES policies(id),
    policy_version INTEGER NOT NULL CHECK (policy_version > 0),
    agent_id VARCHAR(160) NOT NULL,
    tool_name VARCHAR(255) NOT NULL,
    arguments JSONB NOT NULL,
    risk_tier VARCHAR(16) NOT NULL,
    matched_rule_id UUID REFERENCES rules(id),
    effect VARCHAR(32) NOT NULL,
    decided_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT ck_decisions_risk_tier CHECK (
        risk_tier IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')
    ),
    CONSTRAINT ck_decisions_effect CHECK (effect IN ('ALLOW', 'DENY', 'REQUIRE_APPROVAL'))
);

CREATE INDEX idx_decisions_decided_at ON decisions(decided_at, id);

CREATE TABLE approvals (
    id UUID PRIMARY KEY,
    decision_id UUID NOT NULL UNIQUE REFERENCES decisions(id),
    status VARCHAR(16) NOT NULL,
    decided_by VARCHAR(160),
    decided_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT ck_approvals_status CHECK (status IN ('PENDING', 'APPROVED', 'DENIED', 'EXPIRED')),
    CONSTRAINT ck_approvals_state CHECK (
        (status = 'PENDING' AND decided_by IS NULL AND decided_at IS NULL)
        OR (status IN ('APPROVED', 'DENIED') AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
        OR (status = 'EXPIRED' AND decided_by IS NULL AND decided_at IS NOT NULL)
    )
);

CREATE INDEX idx_approvals_pending_expiry ON approvals(status, expires_at, id);

CREATE TABLE accounts (
    id UUID PRIMARY KEY,
    currency VARCHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    status VARCHAR(16) NOT NULL CHECK (status IN ('ACTIVE', 'CLOSED')),
    ledger_balance_minor BIGINT NOT NULL DEFAULT 0 CHECK (ledger_balance_minor >= 0),
    available_balance_minor BIGINT NOT NULL DEFAULT 0 CHECK (available_balance_minor >= 0),
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT ck_accounts_available_not_above_ledger CHECK (
        available_balance_minor <= ledger_balance_minor
    )
);

CREATE TABLE transfers (
    id UUID PRIMARY KEY,
    idempotency_key VARCHAR(200) NOT NULL UNIQUE,
    from_account UUID NOT NULL REFERENCES accounts(id),
    to_account UUID NOT NULL REFERENCES accounts(id),
    amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
    currency VARCHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    state VARCHAR(16) NOT NULL CHECK (
        state IN ('PENDING', 'AUTHORIZED', 'HELD', 'DENIED', 'POSTED', 'REVERSED')
    ),
    reason_code VARCHAR(64),
    decision_id UUID NOT NULL UNIQUE REFERENCES decisions(id),
    approval_id UUID UNIQUE REFERENCES approvals(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    posted_at TIMESTAMP WITH TIME ZONE,
    reversed_at TIMESTAMP WITH TIME ZONE,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT ck_transfers_distinct_accounts CHECK (from_account <> to_account),
    CONSTRAINT ck_transfers_state_data CHECK (
        (state = 'PENDING' AND reason_code IS NULL AND posted_at IS NULL AND reversed_at IS NULL)
        OR (state = 'AUTHORIZED' AND reason_code IS NULL AND posted_at IS NULL AND reversed_at IS NULL)
        OR (state = 'HELD' AND approval_id IS NOT NULL AND reason_code IS NULL
            AND posted_at IS NULL AND reversed_at IS NULL)
        OR (state = 'DENIED' AND reason_code IS NOT NULL AND posted_at IS NULL AND reversed_at IS NULL)
        OR (state = 'POSTED' AND reason_code IS NULL AND posted_at IS NOT NULL AND reversed_at IS NULL)
        OR (state = 'REVERSED' AND reason_code IS NOT NULL AND reversed_at IS NOT NULL)
    )
);

CREATE INDEX idx_transfers_source_velocity ON transfers(from_account, created_at, state);

CREATE TABLE entries (
    id UUID PRIMARY KEY,
    transfer_id UUID NOT NULL REFERENCES transfers(id),
    account_id UUID NOT NULL REFERENCES accounts(id),
    direction VARCHAR(8) NOT NULL CHECK (direction IN ('DEBIT', 'CREDIT')),
    amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE INDEX idx_entries_transfer ON entries(transfer_id, created_at, id);
CREATE INDEX idx_entries_account ON entries(account_id, created_at, id);

CREATE TABLE audit_records (
    id UUID PRIMARY KEY,
    event_type VARCHAR(32) NOT NULL,
    aggregate_type VARCHAR(32) NOT NULL,
    aggregate_id UUID NOT NULL,
    occurred_at TIMESTAMP WITH TIME ZONE NOT NULL,
    details JSONB NOT NULL,
    CONSTRAINT ck_audit_event_type CHECK (
        event_type IN (
            'POLICY_CREATED', 'RULE_CREATED', 'DECISION_CREATED',
            'APPROVAL_CREATED', 'APPROVAL_APPROVED', 'APPROVAL_DENIED',
            'APPROVAL_EXPIRED', 'DLQ_REPLAYED', 'ACCOUNT_CREATED',
            'ACCOUNT_DEPOSITED', 'TRANSFER_CREATED', 'TRANSFER_POSTED',
            'TRANSFER_HELD', 'TRANSFER_DENIED', 'TRANSFER_REVERSED'
        )
    )
);

CREATE INDEX idx_audit_records_time_range ON audit_records(occurred_at, id);
CREATE INDEX idx_audit_records_aggregate
    ON audit_records(aggregate_type, aggregate_id, occurred_at);

CREATE TABLE idempotency_records (
    key VARCHAR(200) PRIMARY KEY,
    request_hash VARCHAR(64) NOT NULL,
    status_code INTEGER,
    response_body JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT ck_idempotency_response_complete CHECK (
        (status_code IS NULL AND response_body IS NULL)
        OR (status_code IS NOT NULL AND response_body IS NOT NULL)
    )
);

CREATE INDEX idx_idempotency_records_created_at ON idempotency_records(created_at);

CREATE TABLE outbox_messages (
    id UUID PRIMARY KEY,
    aggregate_type VARCHAR(32) NOT NULL,
    aggregate_id UUID NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    sent_at TIMESTAMP WITH TIME ZONE,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    last_error TEXT
);

CREATE INDEX idx_outbox_messages_pending
    ON outbox_messages(created_at, id)
    WHERE sent_at IS NULL;

CREATE TABLE processed_messages (
    message_id VARCHAR(128) PRIMARY KEY,
    processed_at TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE INDEX idx_processed_messages_processed_at ON processed_messages(processed_at);

CREATE FUNCTION reject_immutable_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION '% is immutable', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER decisions_are_immutable
    BEFORE UPDATE OR DELETE ON decisions
    FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();

CREATE TRIGGER entries_are_immutable
    BEFORE UPDATE OR DELETE ON entries
    FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();

CREATE TRIGGER audit_records_are_append_only
    BEFORE UPDATE OR DELETE ON audit_records
    FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();

CREATE FUNCTION assert_transfer_entries_balanced(checked_transfer_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    transfer_state VARCHAR(16);
    entry_count BIGINT;
    signed_total NUMERIC;
BEGIN
    SELECT state INTO transfer_state FROM transfers WHERE id = checked_transfer_id;
    IF transfer_state IS NULL THEN
        RETURN;
    END IF;

    SELECT COUNT(*),
           COALESCE(SUM(CASE direction WHEN 'CREDIT' THEN amount_minor ELSE -amount_minor END), 0)
      INTO entry_count, signed_total
      FROM entries
     WHERE transfer_id = checked_transfer_id;

    IF signed_total <> 0 THEN
        RAISE EXCEPTION 'transfer % entries are not balanced (signed total %)',
            checked_transfer_id, signed_total;
    END IF;
    IF transfer_state = 'POSTED' AND entry_count < 2 THEN
        RAISE EXCEPTION 'posted transfer % has no complete double-entry posting', checked_transfer_id;
    END IF;
END;
$$;

CREATE FUNCTION check_entry_transfer_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        PERFORM assert_transfer_entries_balanced(OLD.transfer_id);
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        PERFORM assert_transfer_entries_balanced(NEW.transfer_id);
    END IF;
    RETURN NULL;
END;
$$;

CREATE FUNCTION check_transfer_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM assert_transfer_entries_balanced(NEW.id);
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER entries_balance_at_commit
    AFTER INSERT OR UPDATE OR DELETE ON entries
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION check_entry_transfer_balance();

CREATE CONSTRAINT TRIGGER transfer_balance_at_commit
    AFTER INSERT OR UPDATE ON transfers
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION check_transfer_balance();
