-- Curated layer for Rayfin consumption.
-- Source expectation: a raw scrape table/view named roadmap_raw_scrape with the
-- Fabric roadmap JSON fields landed as-is.
-- This keeps raw source columns intact and adds canonical status fields.

CREATE OR REPLACE VIEW roadmap_curated AS
SELECT
  r.*,
  CASE
    WHEN LOWER(TRIM(COALESCE(r.releaseType, ''))) IN (
      'general availability',
      'generally available',
      'ga',
      'general availibility',
      'general availibility '
    ) THEN 'ga'
    WHEN LOWER(TRIM(COALESCE(r.releaseType, ''))) LIKE '%preview%'
      OR LOWER(TRIM(COALESCE(r.releaseType, ''))) IN (
        'preview',
        'publiew',
        'private preview'
      ) THEN 'preview'
    ELSE LOWER(TRIM(COALESCE(r.releaseType, '')))
  END AS normalized_release_type,
  CASE
    WHEN LOWER(TRIM(COALESCE(r.releaseStatus, ''))) IN ('shipped', 'released', 'available')
      THEN 'shipped'
    WHEN LOWER(TRIM(COALESCE(r.releaseStatus, ''))) IN ('planned', 'preview', 'in preview')
      THEN 'planned'
    ELSE LOWER(TRIM(COALESCE(r.releaseStatus, '')))
  END AS normalized_release_status,
  CASE
    WHEN LOWER(TRIM(COALESCE(r.releaseType, ''))) IN (
      'general availability',
      'generally available',
      'ga',
      'general availibility',
      'general availibility '
    ) THEN 'ga'
    WHEN LOWER(TRIM(COALESCE(r.releaseType, ''))) LIKE '%preview%'
      OR LOWER(TRIM(COALESCE(r.releaseType, ''))) IN (
        'preview',
        'publiew',
        'private preview'
      ) THEN 'preview'
    ELSE 'other'
  END AS normalized_release_stage
FROM roadmap_raw_scrape r;
