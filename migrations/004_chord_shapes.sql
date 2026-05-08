-- Persistent cache of chord-shape voicings fetched from the Uberchord
-- API. Once a (root + chord-type) combo is in here we never need to
-- hit upstream again — the data is static. The /api/chord-shapes/<name>
-- endpoint reads here first, falls through to upstream on miss, and
-- writes the result back so the next caller is served from Postgres.
--
-- Primary key is the chord name in Uberchord URL form (e.g. "Cmaj7",
-- "Csm7", "Bb7"). Empty `shapes` array is a valid cached value: it
-- means "we asked Uberchord and they have nothing for this name."

CREATE TABLE IF NOT EXISTS chord_shapes (
    name        TEXT        PRIMARY KEY,
    shapes      JSONB       NOT NULL,
    fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
