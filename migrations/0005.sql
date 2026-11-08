CREATE TABLE tool_limits (scope TEXT NOT NULL, window INTEGER NOT NULL, count INTEGER NOT NULL, ticket TEXT, PRIMARY KEY(scope,window));
CREATE TABLE daily_visitors (day INTEGER PRIMARY KEY, count INTEGER NOT NULL);
CREATE TABLE session_end_tokens (visitor_id TEXT PRIMARY KEY, epoch TEXT NOT NULL, token_hash TEXT NOT NULL, expires_at INTEGER NOT NULL);
