-- Sample data. No real money.
ALTER TABLE holds ADD COLUMN send_started_at INTEGER;
DROP INDEX holds_one_dispatch;
CREATE UNIQUE INDEX holds_one_dispatch ON holds(visitor_id,epoch) WHERE status IN ('DISPATCHING','OUTCOME_UNKNOWN');
