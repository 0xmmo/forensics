CREATE TABLE calls (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at      TEXT    NOT NULL,
  provider        TEXT    NOT NULL,
  model           TEXT    NOT NULL,
  streaming       INTEGER NOT NULL,

  request_url        TEXT    NOT NULL,
  request_method     TEXT    NOT NULL,
  request_headers    TEXT    NOT NULL,
  request_body       TEXT    NOT NULL,
  request_body_bytes INTEGER NOT NULL,
  prompt_bytes       INTEGER,
  prompt_hash        TEXT    NOT NULL,

  max_tokens       INTEGER,
  temperature      REAL,
  top_p            REAL,
  top_k            INTEGER,
  reasoning_effort TEXT,
  stop_sequences   TEXT,
  tools_hash       TEXT,
  tools_bytes      INTEGER,

  cache_requested      INTEGER,
  cache_control        TEXT,
  prompt_cache_key     TEXT,
  previous_response_id TEXT,

  request_started_at     TEXT    NOT NULL,
  request_upload_ms      INTEGER,
  first_response_byte_ms INTEGER,
  first_stream_event_ms  INTEGER,
  first_content_delta_ms INTEGER,
  last_content_delta_ms  INTEGER,
  total_ms               INTEGER NOT NULL,
  chunk_timestamps_ms    TEXT,
  chunk_byte_lengths     TEXT,
  network_baseline_ms    INTEGER,

  http_status         INTEGER,
  response_headers    TEXT,
  response_body       TEXT,
  response_body_bytes INTEGER,

  input_tokens       INTEGER,
  output_tokens      INTEGER,
  cache_read_tokens  INTEGER,
  cache_write_tokens INTEGER,
  reasoning_tokens   INTEGER,
  usage_raw          TEXT,
  token_count_source TEXT,
  finish_reason      TEXT,

  provider_request_id    TEXT,
  provider_model_version TEXT,
  provider_api_version   TEXT,
  system_fingerprint     TEXT,
  service_tier           TEXT,
  rate_limit_headers     TEXT,

  http_version      TEXT,
  connection_reused INTEGER,
  remote_address    TEXT,
  client_region     TEXT,

  runner_id         TEXT,
  runner_git_sha    TEXT,
  node_version      TEXT,
  retry_count       INTEGER,
  attempt_index     INTEGER,
  client_request_id TEXT,

  sweep_id        TEXT,
  sweep_seq       INTEGER,
  repeat_index    INTEGER,
  experiment_kind TEXT,
  prompt_kind     TEXT,
  context_type    TEXT    NOT NULL DEFAULT 'unknown',
  in_flight_count INTEGER,
  is_test         INTEGER NOT NULL DEFAULT 1,

  status        TEXT NOT NULL CHECK (status IN ('complete', 'failed')),
  error_message TEXT
);

CREATE INDEX idx_calls_model   ON calls(provider, model, created_at);
CREATE INDEX idx_calls_prompt  ON calls(prompt_hash);
CREATE INDEX idx_calls_sweep   ON calls(sweep_id, sweep_seq);
CREATE INDEX idx_calls_status  ON calls(status);
CREATE INDEX idx_calls_is_test ON calls(is_test);
