/**
 * Validation for alert_recipients create/patch payloads.
 *
 * Kept in a single helper so the create route, the patch route, and any
 * future unit tests all agree on what's acceptable. The helper returns
 * a discriminated result rather than throwing — routes translate the
 * failure into a 400 with the error code and offending field.
 *
 * Rules (from CEO-005 brief):
 *  - email: RFC-ish regex, ≤254 chars
 *  - categories: subset of ALLOWED_CATEGORIES, non-empty
 *  - quiet_hours_start/end: both null OR both set (HH:MM or HH:MM:SS)
 *    Overnight ranges (end < start) are allowed — that's how "10pm to
 *    6am Adelaide" is represented.
 *  - timezone: must be a valid IANA zone
 *  - receives_p0 || receives_p1 || receives_p2 must be true (enforced
 *    here for CREATE; PATCH re-enforces on the merged row server-side
 *    because a partial payload can't know the final state alone).
 */

export const ALLOWED_CATEGORIES = [
  'pipeline',
  'financial',
  'security',
  'api_health',
  'ai_cost',
  'user_support',
] as const;

export type AlertCategory = (typeof ALLOWED_CATEGORIES)[number];

export interface RecipientWriteInput {
  email: string;
  full_name: string | null;
  receives_p0: boolean;
  receives_p1: boolean;
  receives_p2: boolean;
  categories: AlertCategory[];
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  timezone: string;
  active?: boolean;
}

export type RecipientPatchInput = Partial<RecipientWriteInput>;

export type ValidationResult =
  | { ok: true; value: RecipientWriteInput | RecipientPatchInput }
  | { ok: false; code: string; message: string; field?: string };

// RFC5322 is too permissive in practice. This matches the pattern the
// rest of the app uses for signup forms — good enough to block
// obviously malformed input, not intended as deliverability validation.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// HH:MM or HH:MM:SS (Postgres "time without time zone" accepts both).
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

// Cache of IANA zones on first access. Intl.supportedValuesOf is
// available on Node 18+ and all modern browsers; Next 15 runs on a
// Node runtime that has it. If it's ever not available we fall open
// (accept the caller-provided zone) — the DB won't reject it because
// the column is plain text.
let zoneCache: Set<string> | null = null;
function supportedTimezones(): Set<string> | null {
  if (zoneCache) return zoneCache;
  const supported = (
    Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
  ).supportedValuesOf;
  if (typeof supported !== 'function') return null;
  try {
    const zones = supported('timeZone');
    zoneCache = new Set(zones);
    return zoneCache;
  } catch {
    return null;
  }
}

export function validateRecipientPayload(
  raw: unknown,
  opts: { mode: 'create' | 'patch' },
): ValidationResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, code: 'invalid_body', message: 'Body must be a JSON object.' };
  }

  const input = raw as Record<string, unknown>;
  const out: RecipientPatchInput = {};
  const mode = opts.mode;
  const creating = mode === 'create';

  // ----- email -----
  if ('email' in input) {
    const v = input.email;
    if (typeof v !== 'string') {
      return { ok: false, code: 'invalid_email', message: 'email must be a string.', field: 'email' };
    }
    const trimmed = v.trim();
    if (trimmed.length === 0 || trimmed.length > 254 || !EMAIL_RE.test(trimmed)) {
      return {
        ok: false,
        code: 'invalid_email',
        message: 'email must be a well-formed address ≤254 characters.',
        field: 'email',
      };
    }
    out.email = trimmed;
  } else if (creating) {
    return { ok: false, code: 'missing_email', message: 'email is required.', field: 'email' };
  }

  // ----- full_name (nullable) -----
  if ('full_name' in input) {
    const v = input.full_name;
    if (v === null || v === undefined) {
      out.full_name = null;
    } else if (typeof v === 'string') {
      const trimmed = v.trim();
      out.full_name = trimmed.length === 0 ? null : trimmed.slice(0, 200);
    } else {
      return {
        ok: false,
        code: 'invalid_full_name',
        message: 'full_name must be a string or null.',
        field: 'full_name',
      };
    }
  } else if (creating) {
    out.full_name = null;
  }

  // ----- receives_p0 / p1 / p2 -----
  for (const key of ['receives_p0', 'receives_p1', 'receives_p2'] as const) {
    if (key in input) {
      const v = input[key];
      if (typeof v !== 'boolean') {
        return {
          ok: false,
          code: `invalid_${key}`,
          message: `${key} must be a boolean.`,
          field: key,
        };
      }
      out[key] = v;
    } else if (creating) {
      // Defaults mirror the schema.
      out[key] = key === 'receives_p2' ? false : true;
    }
  }

  if (creating) {
    if (!out.receives_p0 && !out.receives_p1 && !out.receives_p2) {
      return {
        ok: false,
        code: 'no_active_channels',
        message: 'Recipient must receive at least one of P0, P1, or P2 alerts.',
        field: 'receives_p0',
      };
    }
  }

  // ----- categories -----
  if ('categories' in input) {
    const v = input.categories;
    if (!Array.isArray(v) || v.length === 0) {
      return {
        ok: false,
        code: 'invalid_categories',
        message: 'categories must be a non-empty array.',
        field: 'categories',
      };
    }
    const allowed: readonly string[] = ALLOWED_CATEGORIES;
    for (const item of v) {
      if (typeof item !== 'string' || !allowed.includes(item)) {
        return {
          ok: false,
          code: 'invalid_category_value',
          message: `categories must be a subset of: ${ALLOWED_CATEGORIES.join(', ')}.`,
          field: 'categories',
        };
      }
    }
    // De-dupe while preserving order.
    out.categories = Array.from(new Set(v as string[])) as AlertCategory[];
  } else if (creating) {
    out.categories = [...ALLOWED_CATEGORIES];
  }

  // ----- quiet_hours_start / quiet_hours_end -----
  const qhKeys = ['quiet_hours_start', 'quiet_hours_end'] as const;
  for (const key of qhKeys) {
    if (key in input) {
      const v = input[key];
      if (v === null || v === undefined) {
        out[key] = null;
      } else if (typeof v === 'string' && TIME_RE.test(v)) {
        out[key] = v;
      } else {
        return {
          ok: false,
          code: `invalid_${key}`,
          message: `${key} must be null or an HH:MM[:SS] time string.`,
          field: key,
        };
      }
    } else if (creating) {
      out[key] = null;
    }
  }

  if (creating) {
    if ((out.quiet_hours_start === null) !== (out.quiet_hours_end === null)) {
      return {
        ok: false,
        code: 'quiet_hours_mismatch',
        message: 'Quiet-hours start and end must both be set or both be null.',
        field: 'quiet_hours_start',
      };
    }
  }

  // ----- timezone -----
  if ('timezone' in input) {
    const v = input.timezone;
    if (typeof v !== 'string' || v.length === 0 || v.length > 64) {
      return {
        ok: false,
        code: 'invalid_timezone',
        message: 'timezone must be a non-empty string.',
        field: 'timezone',
      };
    }
    const zones = supportedTimezones();
    if (zones && !zones.has(v)) {
      return {
        ok: false,
        code: 'invalid_timezone',
        message: `timezone '${v}' is not a recognised IANA zone.`,
        field: 'timezone',
      };
    }
    out.timezone = v;
  } else if (creating) {
    out.timezone = 'Australia/Adelaide';
  }

  // ----- active (patch only accepts it; create defaults true) -----
  if ('active' in input) {
    const v = input.active;
    if (typeof v !== 'boolean') {
      return {
        ok: false,
        code: 'invalid_active',
        message: 'active must be a boolean.',
        field: 'active',
      };
    }
    out.active = v;
  } else if (creating) {
    out.active = true;
  }

  if (mode === 'patch' && Object.keys(out).length === 0) {
    return {
      ok: false,
      code: 'empty_patch',
      message: 'PATCH body must contain at least one field to update.',
    };
  }

  return { ok: true, value: out };
}
