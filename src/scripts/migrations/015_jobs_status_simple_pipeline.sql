-- Migration 015: Extend job_status ENUM with Simple Pipeline values
-- Reference: docs/briefs/SIMPLE_PIPELINE_BRIEF_v2.md § "Files / Modify"
-- Kickoff c1 spec (2026-04-28).
--
-- Heads-up vs kickoff: the kickoff lists the TypeScript additions
-- ("src/types/jobs.ts: add 4 statuses") but does not call out a database
-- migration. Postgres job_status is a USER-DEFINED ENUM (per CLAUDE.md
-- "Job status uses Postgres ENUM — TypeScript JobStatus type must exactly
-- match"). Adding TS-side values without ALTER TYPE means INSERTs / UPDATEs
-- with the new values would fail at the DB layer. This migration closes
-- that gap.
--
-- ADD VALUE IF NOT EXISTS is idempotent. Postgres 12+ allows ALTER TYPE
-- ADD VALUE inside a transaction when the value is added at the end of the
-- enum order, which is what we're doing here.

ALTER TYPE job_status ADD VALUE IF NOT EXISTS 'simple_pipeline_pending';
ALTER TYPE job_status ADD VALUE IF NOT EXISTS 'simple_pipeline_rendering';
ALTER TYPE job_status ADD VALUE IF NOT EXISTS 'simple_pipeline_failed';
ALTER TYPE job_status ADD VALUE IF NOT EXISTS 'simple_pipeline_blocked';

NOTIFY pgrst, 'reload schema';
