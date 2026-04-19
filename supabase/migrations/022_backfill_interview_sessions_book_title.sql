-- 022_backfill_interview_sessions_book_title.sql
--
-- Backfill interview_sessions.book_title from projects.title for rows
-- past the validate stage that ship with NULL book_title.
--
-- Context: handleValidationProceed historically updated projects.title
-- but not interview_sessions.book_title, leaving the column NULL forever.
-- Every display site had a `session.book_title || project.title` fallback
-- that hid the bug — except the cover-generation payload
-- (hooks/use-agent-workflow.ts) which falls back to the literal string
-- 'Untitled'. Users with completed books got AI-generated covers printed
-- with "Untitled".
--
-- The companion code fix lands in the same commit. This migration backfills
-- the historical damage for existing rows.
--
-- Idempotent: only updates rows where book_title IS NULL AND the project
-- has a real (non-Untitled) title AND the session has advanced past validate.

UPDATE interview_sessions s
SET book_title = p.title,
    updated_at = NOW()
FROM projects p
WHERE s.project_id = p.id
  AND s.book_title IS NULL
  AND s.current_agent IS DISTINCT FROM 'validate'
  AND p.title IS NOT NULL
  AND p.title <> ''
  AND p.title NOT ILIKE 'Untitled%';
