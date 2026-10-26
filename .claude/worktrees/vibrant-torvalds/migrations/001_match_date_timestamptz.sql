-- Migration: Convert pl_fixtures.match_date from TIMESTAMP to TIMESTAMPTZ
--
-- Background
-- ----------
-- match_date was originally declared as TIMESTAMP (without time zone). Football-data.org
-- returns kickoff times as UTC ISO strings (utcDate), which node-postgres wrote into the
-- naive column as wall-clock UTC. When Railway's Postgres session runs in UTC that value
-- is read back correctly, but any deviation from UTC causes deadlines to drift by the
-- offset (e.g. 1 hour early during BST).
--
-- This migration converts the column to TIMESTAMPTZ and tells Postgres to interpret the
-- existing naive values as UTC. After running, deadline comparisons are timezone-safe
-- regardless of the DB session timezone.
--
-- After deploying this migration, re-run the fixture import (POST /api/fixtures/import
-- or the admin "Import fixtures" button) so any stale match_date values refreshed since
-- the last import are written back with correct timezone-aware values.

ALTER TABLE pl_fixtures
    ALTER COLUMN match_date TYPE TIMESTAMPTZ
    USING match_date AT TIME ZONE 'UTC';
