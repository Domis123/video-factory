ALTER TABLE jobs ADD COLUMN IF NOT EXISTS full_brief TEXT;
COMMENT ON COLUMN jobs.full_brief IS 'Human-readable dump of context_packet for operator review in S2 sheet. Written by worker when planning completes.';
