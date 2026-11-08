-- Eval publisher has no hold, visitor or Teller authority.
CREATE TABLE eval_runs (
 id TEXT PRIMARY KEY, month TEXT NOT NULL, model TEXT NOT NULL,
 trigger TEXT NOT NULL CHECK(trigger IN ('manual','scheduled','push')),
 started_at INTEGER NOT NULL, reserved_microusd INTEGER NOT NULL CHECK(reserved_microusd=100000),
 report_json TEXT, completed_at INTEGER
);
CREATE INDEX eval_runs_time ON eval_runs(started_at);
