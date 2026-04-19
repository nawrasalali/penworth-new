/**
 * Unit tests for lib/compliance.ts — the pure helper functions.
 *
 * Does NOT exercise createDeletionRequest / createExportRequest against
 * a real Supabase (that would need the full mock infrastructure from
 * apply-form.test.ts). Covers the deadline math and jurisdiction
 * mapping, which are the highest-risk pieces because legal deadline
 * calculations must be correct.
 */

import { describe, it, expect } from 'vitest';
import {
  daysUntilDeadline,
  isDeadlineApproaching,
  isDeadlineBreached,
  inferJurisdictionFromCountryCode,
} from '@/lib/compliance';

describe('lib/compliance — deadline utilities', () => {
  it('returns positive days for future deadline', () => {
    const future = new Date(Date.now() + 25 * 86400_000).toISOString();
    const days = daysUntilDeadline(future);
    expect(days).toBeGreaterThanOrEqual(24);
    expect(days).toBeLessThanOrEqual(25);
  });

  it('returns zero or near-zero for a deadline right now', () => {
    const now = new Date().toISOString();
    const days = daysUntilDeadline(now);
    expect(days).toBeGreaterThanOrEqual(-1);
    expect(days).toBeLessThanOrEqual(0);
  });

  it('returns negative days for past deadline (breach)', () => {
    const past = new Date(Date.now() - 5 * 86400_000).toISOString();
    const days = daysUntilDeadline(past);
    expect(days).toBeLessThanOrEqual(-4);
  });

  it('isDeadlineApproaching returns true within threshold', () => {
    const soon = new Date(Date.now() + 3 * 86400_000).toISOString();
    expect(isDeadlineApproaching(soon, 5)).toBe(true);
  });

  it('isDeadlineApproaching returns false outside threshold', () => {
    const later = new Date(Date.now() + 20 * 86400_000).toISOString();
    expect(isDeadlineApproaching(later, 5)).toBe(false);
  });

  it('isDeadlineApproaching returns false for already-breached deadline', () => {
    // Breach is its own signal, not "approaching"
    const past = new Date(Date.now() - 1 * 86400_000).toISOString();
    expect(isDeadlineApproaching(past, 5)).toBe(false);
  });

  it('isDeadlineBreached returns true for past deadline', () => {
    const past = new Date(Date.now() - 1 * 86400_000).toISOString();
    expect(isDeadlineBreached(past)).toBe(true);
  });

  it('isDeadlineBreached returns false for future deadline', () => {
    const future = new Date(Date.now() + 1 * 86400_000).toISOString();
    expect(isDeadlineBreached(future)).toBe(false);
  });
});

describe('lib/compliance — jurisdiction inference', () => {
  it('maps EU country codes to EU', () => {
    expect(inferJurisdictionFromCountryCode('DE')).toBe('EU');
    expect(inferJurisdictionFromCountryCode('FR')).toBe('EU');
    expect(inferJurisdictionFromCountryCode('NL')).toBe('EU');
  });

  it('maps GB to UK (distinct from EU post-Brexit)', () => {
    expect(inferJurisdictionFromCountryCode('GB')).toBe('UK');
  });

  it('maps Penworth target markets to their own jurisdiction codes', () => {
    expect(inferJurisdictionFromCountryCode('AU')).toBe('AU');
    expect(inferJurisdictionFromCountryCode('IN')).toBe('IN');
    expect(inferJurisdictionFromCountryCode('TH')).toBe('TH');
    expect(inferJurisdictionFromCountryCode('VN')).toBe('VN');
    expect(inferJurisdictionFromCountryCode('ID')).toBe('ID');
    expect(inferJurisdictionFromCountryCode('BD')).toBe('BD');
    expect(inferJurisdictionFromCountryCode('NG')).toBe('NG');
    expect(inferJurisdictionFromCountryCode('SA')).toBe('SA');
    expect(inferJurisdictionFromCountryCode('AE')).toBe('AE');
  });

  it('is case-insensitive', () => {
    expect(inferJurisdictionFromCountryCode('de')).toBe('EU');
    expect(inferJurisdictionFromCountryCode('gb')).toBe('UK');
    expect(inferJurisdictionFromCountryCode('au')).toBe('AU');
  });

  it('returns null for unmapped countries', () => {
    expect(inferJurisdictionFromCountryCode('XY')).toBeNull();
    expect(inferJurisdictionFromCountryCode('ZZ')).toBeNull();
  });

  it('returns null for null/undefined/empty input', () => {
    expect(inferJurisdictionFromCountryCode(null)).toBeNull();
    expect(inferJurisdictionFromCountryCode(undefined)).toBeNull();
    expect(inferJurisdictionFromCountryCode('')).toBeNull();
  });
});
