import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Phase 1E — should_deduct_credits_for_project helper.
 *
 * Every credit-deduction call site in the API calls this BEFORE actually
 * debiting credits. If it returns false, skip the deduction — the project
 * is being billed via a Guild showcase grant (or similar mechanism in
 * future) and charging credits would be a double-charge.
 *
 * Self-healing via the RPC's second branch: even if the project's
 * billing_type UPDATE failed at creation time (race window between
 * guild_consume_showcase_grant and the subsequent UPDATE), the helper
 * still returns false because the guild_showcase_grants row correctly
 * points at the project with status='used'. See migration 014 for the
 * SQL definition.
 *
 * Default: returns true (deduct). If the RPC errors, we default to
 * deducting — better to over-charge and have the user contest than to
 * silently skip a legitimate charge.
 */
export async function shouldDeductCreditsForProject(
  supabase: SupabaseClient,
  projectId: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc(
    'should_deduct_credits_for_project',
    { p_project_id: projectId },
  );

  if (error) {
    console.error(
      '[shouldDeductCreditsForProject] RPC error — defaulting to deduct=true',
      { projectId, error },
    );
    return true;
  }

  // RPC returns boolean. If NULL (shouldn't happen given sql STABLE), default true.
  return data !== false;
}
