-- 037_livebook_match_function.sql
-- CEO-165 — SQL function for paragraph→image matching with diversity penalty
--
-- The retrieval pipeline calls this once per paragraph. The function uses
-- the HNSW index for the initial ANN cut (top 50), then re-ranks within
-- those candidates by adding a soft diversity penalty:
--   adjusted_distance = base_cosine_distance
--                     + 0.05 * uses_in_this_book
--                     + 0.10 * (was_used_in_last_3_paragraphs)
--
-- This keeps a perfect-fit image free to repeat (low base distance wins)
-- while pushing marginal repeats away. Without the penalty, the same hero
-- image would dominate a long book.
--
-- Performance: HNSW handles the heavy lifting (top-50 from 1000+ vectors
-- in <10ms). The diversity penalty is computed over 50 rows max — trivial.

CREATE OR REPLACE FUNCTION livebook_match_image_for_paragraph(
  p_style            text,
  p_query_emb        vector(1024),
  p_used_image_ids   uuid[],
  p_recent_image_ids uuid[],
  p_top_k            int DEFAULT 5
)
RETURNS TABLE (
  id                uuid,
  image_url         text,
  thumbnail_url     text,
  caption           text,
  caption_short     text,
  base_distance     real,
  adjusted_distance real
)
LANGUAGE sql STABLE AS $$
  WITH ann_candidates AS (
    -- HNSW index lookup. The CTE is intentionally bare (no extra WHERE
    -- predicates) so the planner uses the vector index efficiently.
    SELECT
      i.id,
      i.image_url,
      i.thumbnail_url,
      i.caption,
      i.caption_short,
      (i.embedding <=> p_query_emb)::real AS base_distance
    FROM livebook_image_library i
    WHERE i.style_slug = p_style AND i.is_active = true
    ORDER BY i.embedding <=> p_query_emb
    LIMIT 50
  ),
  ranked AS (
    SELECT
      c.id,
      c.image_url,
      c.thumbnail_url,
      c.caption,
      c.caption_short,
      c.base_distance,
      (
        c.base_distance
        + 0.05 * COALESCE(
            (SELECT count(*)::real FROM unnest(p_used_image_ids) u WHERE u = c.id),
            0
          )
        + CASE WHEN c.id = ANY(p_recent_image_ids) THEN 0.10 ELSE 0 END
      )::real AS adjusted_distance
    FROM ann_candidates c
  )
  SELECT id, image_url, thumbnail_url, caption, caption_short, base_distance, adjusted_distance
  FROM ranked
  ORDER BY adjusted_distance ASC
  LIMIT p_top_k;
$$;

COMMENT ON FUNCTION livebook_match_image_for_paragraph IS
  'CEO-165: HNSW top-50 ANN cut + diversity penalty re-rank. Returns top-K candidates for one paragraph, given the paragraph embedding, the set of image ids already used in this book, and the recent-3 ids for adjacency penalty. Caller picks the top-1 unless top-1 and top-2 are within 0.05 — in which case the caller may invoke a Claude reranker.';

-- ============================================================================
-- increment_image_use_count — bump use counter atomically
-- ============================================================================
-- Called by the matching edge function each time it picks an image for a
-- paragraph. The use_count drives cross-book diversity over time: an image
-- that has been used 50 times across the platform should be matched less
-- aggressively than a fresh one (Phase 3 will read this; Phase 1 just
-- maintains the counter).

CREATE OR REPLACE FUNCTION increment_image_use_count(p_image_id uuid)
RETURNS void
LANGUAGE sql AS $$
  UPDATE livebook_image_library
  SET use_count = use_count + 1,
      last_used_at = now()
  WHERE id = p_image_id;
$$;

COMMENT ON FUNCTION increment_image_use_count IS
  'CEO-165: bump use_count + last_used_at when an image is matched. Cheap utility called once per resolved paragraph by admin-match-livebook-images.';
