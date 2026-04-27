-- =============================================================================
-- CEO-167: Auto-populate livebook_image_library from chapter_assets
-- =============================================================================
-- Every new image generated for ANY book becomes a candidate for future
-- matches. The trigger writes a stub row with prompt + image_url; embedding
-- is filled in by a separate backfill job (we don't make Voyage HTTP calls
-- inline — async pg_net in triggers is unreliable, and a sync Voyage call
-- would block the chapter_assets INSERT.)

CREATE OR REPLACE FUNCTION mirror_chapter_asset_to_library()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.status = 'generated'
     AND NEW.image_url IS NOT NULL
     AND NEW.prompt_used IS NOT NULL
     AND NEW.image_provider IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM livebook_image_library WHERE image_url = NEW.image_url
     )
  THEN
    INSERT INTO livebook_image_library (
      style_slug,
      image_url,
      thumbnail_url,
      aspect_ratio,
      caption,
      caption_short,
      tags,
      content_genres,
      mood,
      era,
      embedding,
      source_model,
      source_prompt,
      is_active
    )
    VALUES (
      'pencil_sketch',
      NEW.image_url,
      NEW.image_url,
      '4:3',
      NEW.prompt_used,                        -- caption = the visual prompt
      LEFT(NEW.prompt_used, 100),             -- short version
      ARRAY[]::text[],
      ARRAY[]::text[],
      NULL, NULL,
      NULL,                                   -- embedding deferred
      NEW.image_provider,                     -- source_model
      NEW.prompt_used,
      TRUE
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS chapter_assets_mirror_to_library ON chapter_assets;
CREATE TRIGGER chapter_assets_mirror_to_library
AFTER INSERT OR UPDATE OF image_url, status
ON chapter_assets
FOR EACH ROW
EXECUTE FUNCTION mirror_chapter_asset_to_library();

COMMENT ON FUNCTION mirror_chapter_asset_to_library() IS
  'CEO-167: Mirrors generated chapter_assets images into livebook_image_library so any image generated for any book seeds the future-match library. Embedding is deferred to a backfill job.';

-- Backfill: copy the 40 showcase rows we just inserted
INSERT INTO livebook_image_library (
  style_slug, image_url, thumbnail_url, aspect_ratio,
  caption, caption_short, tags, content_genres, mood, era,
  embedding, source_model, source_prompt, is_active
)
SELECT
  'pencil_sketch',
  ca.image_url,
  ca.image_url,
  '4:3',
  ca.prompt_used,
  LEFT(ca.prompt_used, 100),
  ARRAY[]::text[],
  ARRAY[]::text[],
  NULL, NULL,
  NULL,
  ca.image_provider,
  ca.prompt_used,
  TRUE
FROM chapter_assets ca
WHERE ca.chapter_id = 'bcbca400-dbde-41a1-ae5e-fa34df5418f0'
  AND ca.status = 'generated'
  AND ca.image_url IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM livebook_image_library WHERE image_url = ca.image_url
  );
