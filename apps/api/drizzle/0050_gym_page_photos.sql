-- Photos on a gym's own page (spec Part 3 §16.3; ROADMAP 20c-iv-b; RULINGS 2026-09-28):
-- at most 10 a gym, 2 MB each, "just for people to see facilities". The file is in the
-- photo store under `storage_key`; this row is what the page shows, in `position` order.
-- A position is 0 to 9 and unique within the gym, so the database itself refuses an
-- eleventh photo; the constraint is checked at commit, so a reorder can swap two.
-- `upload_key` is the browser's own key for one picked photo: the same photo sent again
-- (its reply lost on a phone's network) is the photo already kept, never a second one.
CREATE TABLE gym_page_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id uuid NOT NULL REFERENCES gyms (id) ON DELETE CASCADE,
  storage_key text NOT NULL,
  content_type text NOT NULL,
  byte_size integer NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  position smallint NOT NULL,
  upload_key uuid NOT NULL,
  added_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gym_page_photos_storage_key_uq UNIQUE (storage_key),
  CONSTRAINT gym_page_photos_upload_key_uq UNIQUE (gym_id, upload_key),
  CONSTRAINT gym_page_photos_position_uq UNIQUE (gym_id, position) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT gym_page_photos_type_check CHECK (content_type IN ('image/jpeg','image/png','image/webp')),
  CONSTRAINT gym_page_photos_size_check CHECK (byte_size BETWEEN 1 AND 2097152),
  CONSTRAINT gym_page_photos_width_check CHECK (width BETWEEN 1 AND 8000),
  CONSTRAINT gym_page_photos_height_check CHECK (height BETWEEN 1 AND 8000),
  CONSTRAINT gym_page_photos_position_check CHECK (position BETWEEN 0 AND 9)
);
