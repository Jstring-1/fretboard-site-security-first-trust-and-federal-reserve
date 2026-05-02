-- 002_songs.sql — chord-extracted song catalogue.
--
-- One row per (book, pdf_page, title). Fed by the local
-- _books/_publish_chords.py importer that reads the consolidated
-- _index/_chords/_all.json and bulk-upserts into this table.

CREATE TABLE IF NOT EXISTS songs (
  id              BIGSERIAL PRIMARY KEY,
  book            TEXT        NOT NULL,
  pdf_page        INTEGER     NOT NULL,
  title           TEXT        NOT NULL,
  -- Generated upper-cased title for case-insensitive search /
  -- alphabetical sort. Stored so the index can use it directly.
  title_upper     TEXT        GENERATED ALWAYS AS (UPPER(title)) STORED,
  song_key        TEXT,
  time_signature  TEXT,
  confidence      TEXT,
  chords          TEXT[]      NOT NULL DEFAULT '{}',
  degrees         TEXT[]      NOT NULL DEFAULT '{}',
  sections        JSONB,
  notes           TEXT,
  -- True iff at least one chord symbol is present. Lets the search
  -- endpoint cheaply filter to "chord data available" rows.
  has_chords      BOOLEAN     GENERATED ALWAYS AS (cardinality(chords) > 0) STORED,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- (book, pdf_page, title) is the natural key — same song extracted
-- twice on the same page should idempotently upsert.
CREATE UNIQUE INDEX IF NOT EXISTS songs_book_page_title
  ON songs (book, pdf_page, title);

CREATE INDEX IF NOT EXISTS songs_title_upper ON songs (title_upper);
CREATE INDEX IF NOT EXISTS songs_has_chords  ON songs (has_chords) WHERE has_chords = true;

-- Auto-touch updated_at on UPDATE — same pattern as user_settings.
CREATE OR REPLACE FUNCTION songs_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS songs_touch ON songs;
CREATE TRIGGER songs_touch
  BEFORE UPDATE ON songs
  FOR EACH ROW
  EXECUTE FUNCTION songs_touch_updated_at();
