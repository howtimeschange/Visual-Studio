-- External identity is bound by issuer + subject, never by an unverified email.
CREATE TABLE IF NOT EXISTS external_identities (
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  ciphertext TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  refresh_lease_until INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (issuer, subject),
  UNIQUE (user_id, issuer)
);

CREATE TABLE IF NOT EXISTS oauth_flows (
  state_hash TEXT PRIMARY KEY,
  ciphertext TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oauth_flows_expires ON oauth_flows(expires_at);
