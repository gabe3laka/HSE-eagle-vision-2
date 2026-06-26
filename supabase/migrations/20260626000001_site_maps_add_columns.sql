-- site_maps was created in 20260625000004 without image_url and scale_m_per_px.
-- Add them now so useSiteMaps.ts insert/select can resolve the columns.
-- map_image_url is kept for schema completeness; image_url is the app-facing field.
ALTER TABLE site_maps ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE site_maps ADD COLUMN IF NOT EXISTS scale_m_per_px numeric;
