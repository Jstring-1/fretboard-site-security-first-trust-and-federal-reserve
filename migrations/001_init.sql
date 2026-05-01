-- 001_init.sql — initial SlantFinder.pro schema.
--
-- One JSONB blob per Clerk user. We store everything personalisable
-- (saved tabs, chord-box libraries, custom tunings, song-key overrides,
-- favourites, etc.) inside `data` so we can ship new features without a
-- migration each time. Promote heavily-queried fields to real columns
-- only when query patterns demand it.

CREATE TABLE IF NOT EXISTS user_settings (
  clerk_user_id TEXT        PRIMARY KEY,
  data          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Touch updated_at automatically on any UPDATE so the app code doesn't
-- have to remember to set it.
CREATE OR REPLACE FUNCTION user_settings_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS user_settings_touch ON user_settings;
CREATE TRIGGER user_settings_touch
  BEFORE UPDATE ON user_settings
  FOR EACH ROW
  EXECUTE FUNCTION user_settings_touch_updated_at();
