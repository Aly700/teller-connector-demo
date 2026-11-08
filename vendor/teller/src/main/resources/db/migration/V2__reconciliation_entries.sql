ALTER TABLE entries ADD COLUMN posting_id UUID;
ALTER TABLE entries ADD COLUMN currency VARCHAR(3);

ALTER TABLE entries DISABLE TRIGGER entries_are_immutable;
UPDATE entries entry
   SET posting_id = entry.transfer_id,
       currency = transfer.currency
  FROM transfers transfer
 WHERE transfer.id = entry.transfer_id;
ALTER TABLE entries ENABLE TRIGGER entries_are_immutable;

ALTER TABLE entries ALTER COLUMN posting_id SET NOT NULL;
ALTER TABLE entries ALTER COLUMN currency SET NOT NULL;
ALTER TABLE entries ALTER COLUMN transfer_id DROP NOT NULL;
ALTER TABLE entries ALTER COLUMN account_id DROP NOT NULL;
ALTER TABLE entries ADD CONSTRAINT ck_entries_currency CHECK (currency ~ '^[A-Z]{3}$');
ALTER TABLE entries ADD CONSTRAINT ck_entries_transfer_account CHECK (
    transfer_id IS NULL OR account_id IS NOT NULL
);

CREATE INDEX idx_entries_posting ON entries(posting_id, created_at, id);
CREATE INDEX idx_entries_export ON entries(created_at, id);

DROP TRIGGER entries_balance_at_commit ON entries;
DROP TRIGGER transfer_balance_at_commit ON transfers;
DROP FUNCTION check_entry_transfer_balance();
DROP FUNCTION check_transfer_balance();
DROP FUNCTION assert_transfer_entries_balanced(UUID);

CREATE FUNCTION assert_posting_entries_balanced(checked_posting_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    entry_count BIGINT;
    currency_count BIGINT;
    signed_total NUMERIC;
BEGIN
    SELECT COUNT(*),
           COUNT(DISTINCT currency),
           COALESCE(SUM(CASE direction WHEN 'CREDIT' THEN amount_minor ELSE -amount_minor END), 0)
      INTO entry_count, currency_count, signed_total
      FROM entries
     WHERE posting_id = checked_posting_id;

    IF entry_count < 2 THEN
        RAISE EXCEPTION 'posting % has fewer than two entries', checked_posting_id;
    END IF;
    IF currency_count <> 1 THEN
        RAISE EXCEPTION 'posting % mixes currencies', checked_posting_id;
    END IF;
    IF signed_total <> 0 THEN
        RAISE EXCEPTION 'posting % entries are not balanced (signed total %)',
            checked_posting_id, signed_total;
    END IF;
END;
$$;

CREATE FUNCTION check_entry_posting_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        PERFORM assert_posting_entries_balanced(OLD.posting_id);
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        PERFORM assert_posting_entries_balanced(NEW.posting_id);
    END IF;
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER entries_balance_at_commit
    AFTER INSERT OR UPDATE OR DELETE ON entries
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION check_entry_posting_balance();

CREATE FUNCTION assert_transfer_entries_balanced(checked_transfer_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    transfer_state VARCHAR(16);
    transfer_currency VARCHAR(3);
    entry_count BIGINT;
    wrong_currency_count BIGINT;
    signed_total NUMERIC;
BEGIN
    SELECT state, currency
      INTO transfer_state, transfer_currency
      FROM transfers
     WHERE id = checked_transfer_id;
    IF transfer_state IS NULL THEN
        RETURN;
    END IF;

    SELECT COUNT(*),
           COUNT(*) FILTER (WHERE currency <> transfer_currency),
           COALESCE(SUM(CASE direction WHEN 'CREDIT' THEN amount_minor ELSE -amount_minor END), 0)
      INTO entry_count, wrong_currency_count, signed_total
      FROM entries
     WHERE transfer_id = checked_transfer_id;

    IF wrong_currency_count <> 0 THEN
        RAISE EXCEPTION 'transfer % entries use a different currency', checked_transfer_id;
    END IF;
    IF signed_total <> 0 THEN
        RAISE EXCEPTION 'transfer % entries are not balanced (signed total %)',
            checked_transfer_id, signed_total;
    END IF;
    IF transfer_state = 'POSTED' AND entry_count < 2 THEN
        RAISE EXCEPTION 'posted transfer % has no complete double-entry posting', checked_transfer_id;
    END IF;
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

CREATE CONSTRAINT TRIGGER transfer_balance_at_commit
    AFTER INSERT OR UPDATE ON transfers
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION check_transfer_balance();

CREATE TABLE reconciliation_runs (
    id UUID PRIMARY KEY,
    business_date DATE NOT NULL,
    status VARCHAR(16) NOT NULL CHECK (status IN ('MATCHED', 'MISMATCH')),
    entry_object_key TEXT NOT NULL,
    audit_object_key TEXT NOT NULL,
    database_row_count INTEGER NOT NULL CHECK (database_row_count >= 0),
    export_row_count INTEGER NOT NULL CHECK (export_row_count >= 0),
    details JSONB NOT NULL,
    completed_at TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE INDEX idx_reconciliation_runs_latest
    ON reconciliation_runs(completed_at DESC, id DESC);

ALTER TABLE audit_records DROP CONSTRAINT ck_audit_event_type;
ALTER TABLE audit_records ADD CONSTRAINT ck_audit_event_type CHECK (
    event_type IN (
        'POLICY_CREATED', 'RULE_CREATED', 'DECISION_CREATED',
        'APPROVAL_CREATED', 'APPROVAL_APPROVED', 'APPROVAL_DENIED',
        'APPROVAL_EXPIRED', 'DLQ_REPLAYED', 'ACCOUNT_CREATED',
        'ACCOUNT_DEPOSITED', 'TRANSFER_CREATED', 'TRANSFER_POSTED',
        'TRANSFER_HELD', 'TRANSFER_DENIED', 'TRANSFER_REVERSED',
        'RECONCILIATION_MISMATCH'
    )
);
