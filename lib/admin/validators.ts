/**
 * Payload validation for /api/admin/kb POST and PATCH handlers.
 *
 * Extracted out of app/api/admin/kb/route.ts because Next.js 15 route
 * files may only export the HTTP verb handlers (GET/POST/...) and a
 * fixed set of config constants (runtime, dynamic, maxDuration, etc.).
 * Exporting arbitrary helpers from a route file causes the build to
 * fail with:
 *
 *   Type error: Route "app/api/admin/kb/route.ts" does not match the
 *   required types of a Next.js Route.
 *   "validateArticlePayload" is not a valid Route export field.
 *
 * The canonical fix is to put shared helpers next to routes but not
 * inside route.ts files.
 */

export function validateArticlePayload(
  body: any,
): { ok: true } | { ok: false; error: string } {
  if (typeof body.slug !== 'string' || body.slug.trim().length === 0) {
    return { ok: false, error: 'slug is required' };
  }
  if (typeof body.title !== 'string' || body.title.trim().length === 0) {
    return { ok: false, error: 'title is required' };
  }
  if (
    typeof body.content_markdown !== 'string' ||
    body.content_markdown.trim().length === 0
  ) {
    return { ok: false, error: 'content_markdown is required' };
  }
  if (!Array.isArray(body.surface_scope) || body.surface_scope.length === 0) {
    return { ok: false, error: 'surface_scope must be a non-empty array' };
  }
  if (!Array.isArray(body.role_scope) || body.role_scope.length === 0) {
    return { ok: false, error: 'role_scope must be a non-empty array' };
  }
  if (body.tags && !Array.isArray(body.tags)) {
    return { ok: false, error: 'tags must be an array if provided' };
  }
  return { ok: true };
}

/**
 * Payload validation for /api/admin/known-issues POST and PATCH.
 * Mirrors the CHECK constraints on nora_known_issues table.
 */
export function validateKnownIssuePayload(
  body: any,
): { ok: true } | { ok: false; error: string } {
  if (typeof body.pattern_slug !== 'string' || body.pattern_slug.trim().length === 0) {
    return { ok: false, error: 'pattern_slug is required' };
  }
  if (typeof body.title !== 'string' || body.title.trim().length === 0) {
    return { ok: false, error: 'title is required' };
  }
  if (body.symptom_keywords && !Array.isArray(body.symptom_keywords)) {
    return { ok: false, error: 'symptom_keywords must be an array' };
  }
  if (body.auto_fix_tool && body.auto_fix_tier !== null && body.auto_fix_tier !== undefined) {
    if (![1, 2, 3].includes(body.auto_fix_tier)) {
      return { ok: false, error: 'auto_fix_tier must be 1, 2, or 3' };
    }
  }
  if (body.escalate_after_attempts !== undefined) {
    const n = Number(body.escalate_after_attempts);
    if (!Number.isInteger(n) || n < 1 || n > 10) {
      return { ok: false, error: 'escalate_after_attempts must be an integer 1-10' };
    }
  }
  return { ok: true };
}
