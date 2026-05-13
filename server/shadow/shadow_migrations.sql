-- Shadow Learning Genius Patch v1 logical schema reference.
-- Runtime persistence in this repo remains JSON/ledger based; these DDL names document DB parity.
CREATE TABLE IF NOT EXISTS shadow_cases (case_id TEXT PRIMARY KEY, signal_id TEXT, symbol TEXT, payload JSONB, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS shadow_state_transitions (id BIGSERIAL PRIMARY KEY, case_id TEXT, from_state TEXT, to_state TEXT, payload JSONB, created_at TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS shadow_return_flow_checks (id BIGSERIAL PRIMARY KEY, case_id TEXT, symbol TEXT, lookup_day INT, payload JSONB, created_at TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS shadow_integrity_events (id BIGSERIAL PRIMARY KEY, item TEXT, severity TEXT, payload JSONB, created_at TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS shadow_reflections (id BIGSERIAL PRIMARY KEY, trade_date DATE, payload JSONB, created_at TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS shadow_promotion_reports (id BIGSERIAL PRIMARY KEY, status TEXT, payload JSONB, created_at TIMESTAMPTZ);
