-- Sample data. No real money.
CREATE TABLE holds (
  id TEXT PRIMARY KEY, visitor_id TEXT NOT NULL, epoch TEXT NOT NULL,
  request_key TEXT NOT NULL, reference TEXT NOT NULL, pool_id TEXT NOT NULL,
  arguments_json TEXT NOT NULL, body_json TEXT NOT NULL, body_hash TEXT NOT NULL,
  teller_key TEXT NOT NULL UNIQUE CHECK(length(teller_key)<=200),
  policy_version TEXT NOT NULL, policy_rule TEXT NOT NULL,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('HELD','DENIED','EXPIRED','DISPATCHING','POSTED','TELLER_HELD','TELLER_DENIED','UPSTREAM_REJECTED','OUTCOME_UNKNOWN')),
  version INTEGER NOT NULL DEFAULT 0, journal_json TEXT NOT NULL CHECK(length(CAST(journal_json AS BLOB))<=262144),
  csrf_hash TEXT, csrf_expires_at INTEGER,
  approver TEXT, approved_at INTEGER, attempt_id TEXT, dispatch_at INTEGER,
  replay_count INTEGER NOT NULL DEFAULT 0 CHECK(replay_count BETWEEN 0 AND 3),
  teller_id TEXT, result_json TEXT, error_code TEXT,
  UNIQUE(visitor_id,epoch,request_key), UNIQUE(visitor_id,epoch,reference)
);
CREATE INDEX holds_visitor ON holds(visitor_id,epoch,created_at);
CREATE INDEX holds_due ON holds(status,expires_at);
CREATE UNIQUE INDEX holds_one_dispatch ON holds(visitor_id,epoch) WHERE status='DISPATCHING';
CREATE TRIGGER holds_immutable BEFORE UPDATE OF id,visitor_id,epoch,request_key,reference,pool_id,arguments_json,body_json,body_hash,teller_key,policy_version,policy_rule,created_at,expires_at ON holds
BEGIN SELECT RAISE(ABORT,'immutable request'); END;
ALTER TABLE audit_events ADD COLUMN event_json TEXT;
