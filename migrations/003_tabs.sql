-- 003_tabs.sql — tablature catalogue.
--
-- Parallel to `songs` but tab-shaped: tuning + per-measure note events
-- instead of a chord progression. One row per (book, pdf_page, title)
-- so a single tab book can have many distinct songs/tabs per page.
--
-- `measures` is a JSONB array of objects with this shape:
--   { "chord": "Em7" | null,
--     "events": [
--        { "string": 6, "fret": 0, "beat": 1.0, "mod": null },
--        { "string": 5, "fret": 2, "beat": 1.0, "mod": "h" }
--     ] }
-- See _books/_tab_extract.py prompt for the canonical schema.

CREATE TABLE IF NOT EXISTS tabs (
  id              BIGSERIAL PRIMARY KEY,
  book            TEXT        NOT NULL,
  pdf_page        INTEGER     NOT NULL,
  title           TEXT        NOT NULL,
  title_upper     TEXT        GENERATED ALWAYS AS (UPPER(title)) STORED,
  tuning          TEXT,                                -- "EADGBE" / "DADGAD" / "GBDGBD" etc.
  strings         INTEGER,
  song_key        TEXT,
  time_signature  TEXT,
  measures        JSONB       NOT NULL DEFAULT '[]'::jsonb,
  notes           TEXT,
  confidence      TEXT,
  has_data        BOOLEAN     GENERATED ALWAYS AS (jsonb_array_length(measures) > 0) STORED,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS tabs_book_page_title
  ON tabs (book, pdf_page, title);

CREATE INDEX IF NOT EXISTS tabs_title_upper ON tabs (title_upper);
CREATE INDEX IF NOT EXISTS tabs_has_data    ON tabs (has_data) WHERE has_data = true;

CREATE OR REPLACE FUNCTION tabs_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tabs_touch ON tabs;
CREATE TRIGGER tabs_touch
  BEFORE UPDATE ON tabs
  FOR EACH ROW
  EXECUTE FUNCTION tabs_touch_updated_at();
