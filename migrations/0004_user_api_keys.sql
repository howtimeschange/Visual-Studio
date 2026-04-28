CREATE TABLE IF NOT EXISTS user_api_keys (
  user_id TEXT PRIMARY KEY,
  ciphertext TEXT NOT NULL,
  key_version TEXT NOT NULL DEFAULT 'v1',
  summary_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_api_keys_updated_at ON user_api_keys(updated_at);
