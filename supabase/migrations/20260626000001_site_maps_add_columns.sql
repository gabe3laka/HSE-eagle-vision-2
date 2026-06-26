-- Migration 20260625000004 was first applied to the remote DB without
-- image_url and scale_m_per_px on site_maps. This additive migration adds
-- them so useSiteMaps.ts insert/select resolves those columns.
-- On a fresh local reset migration 20260625000004 already includes both
-- columns, so these become safe no-ops via IF NOT EXISTS.
-- map_image_url is kept in the base table for schema completeness;
-- image_url is the app-facing field used by useCreateSiteMap.

ALTER TABLE public.site_maps
  ADD COLUMN IF NOT EXISTS image_url text;

ALTER TABLE public.site_maps
  ADD COLUMN IF NOT EXISTS scale_m_per_px numeric;
