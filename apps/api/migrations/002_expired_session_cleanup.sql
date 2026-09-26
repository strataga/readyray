CREATE INDEX sessions_by_expiry ON sessions (expires_at, token_digest);
