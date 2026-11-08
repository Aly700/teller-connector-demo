-- Sample data. No real money.
CREATE TABLE IF NOT EXISTS config (
  id INTEGER PRIMARY KEY CHECK(id=1), epoch TEXT NOT NULL,
  expires_at INTEGER NOT NULL, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  maintenance INTEGER NOT NULL CHECK(maintenance IN (0,1)),
  tools_json TEXT NOT NULL, ip_salt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sample_registry (
  pool_id TEXT PRIMARY KEY, epoch TEXT NOT NULL,
  visitor_id TEXT UNIQUE, accounts_json TEXT NOT NULL, transfers_json TEXT NOT NULL,
  request_slots_json TEXT
);
CREATE TABLE IF NOT EXISTS visitors (
  id TEXT PRIMARY KEY, epoch TEXT NOT NULL, session_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0,
  sample_data INTEGER NOT NULL DEFAULT 1 CHECK(sample_data=1),
  notice TEXT NOT NULL DEFAULT 'Sample data. No real money.'
);
CREATE TABLE IF NOT EXISTS consent_limits (
  ip_hash TEXT NOT NULL, window INTEGER NOT NULL, count INTEGER NOT NULL,
  PRIMARY KEY(ip_hash, window)
);
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY, occurred_at INTEGER NOT NULL, visitor_id TEXT,
  epoch TEXT, tool TEXT, code TEXT NOT NULL,
  sample_data INTEGER NOT NULL DEFAULT 1 CHECK(sample_data=1),
  notice TEXT NOT NULL DEFAULT 'Sample data. No real money.'
);
