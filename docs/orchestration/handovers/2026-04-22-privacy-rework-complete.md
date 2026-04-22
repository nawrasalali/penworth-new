# Handover — Privacy rework complete (CEO-030)

**Date:** 22 April 2026
**Status:** Shipped end-to-end. All code, copy, and DB migration applied. Not awaiting anything.
**Task code:** CEO-030 (commits reference CEO-014 for historical reasons — see note at end)

---

## What was wrong

The prior product design made the phrase "Authors own their readers" a **founding commitment**
of the store. Every purchase was to ship the author the reader's email, country, and reading
progress via a CSV export. There was a live API endpoint, a UI dashboard page, a service-role
data-access function that bypassed RLS to deliver it, a settings toggle readers could use to
"opt in," a /covenants marketing page built around it, and a FiveCovenants homepage tile.

This is a privacy liability under both GDPR and the Australian Privacy Act. The Founder's
framing in the correction message: *"Uber never gives riders details to drivers. Amazon is not
sharing the same. We also never share the same. We should give up all the concept of covenant.
No promises we give."*

## What shipped

Three commits, one DB migration. All in production.

### `penworth-store` @ `c1a3572` — main privacy rework

**Deleted files:**
- `app/api/for-authors/readers.csv/route.ts` — the CSV export endpoint
- `app/for-authors/dashboard/readers/page.tsx` — its dashboard UI
- `lib/data/author-readers.ts` — the service-role data layer (RLS bypass)
- `app/covenants/page.tsx` — founding-document marketing page
- `components/store/five-covenants.tsx` — homepage tile
- `components/store/sharing-toggle.tsx` — opt-in toggle component

**Rewrote ~20 pages removing covenant language:**
- Homepage: FiveCovenants tile removed.
- Site footer: `/covenants` nav link removed.
- `/about`: "The commitments that run this store" → "How the store works" with explicit
  *"Reader identity is kept private from authors and from third parties."*
- `/legal/privacy` §3: previously said authors receive email + country + progress. Now says
  *"Authors receive aggregated, non-identifying information about their books: total
  purchases, country-level breakdowns, and ebook reading completion rates (not per-reader).
  They do not receive your email, your name, your location beyond country, or any identifier
  that connects a purchase to you as a person."*
- `/legal/privacy` §4 adds: *"We never share your email or name with authors or any third
  party for marketing."*
- `/legal/terms` §10: "Our covenants" → factual "Our store terms" (price, non-exclusivity,
  royalty rates, reader privacy) with no promise framing.
- `/for-authors/pricing`: the perk "Your reader list from day one" → "Aggregated,
  country-level analytics for every book". The "Reader data delivery — the reader list is a
  covenant, not a paid feature" line gone.
- `/for-authors/dashboard`: "Your readers" nav button removed; subtitle changed from "Your
  books and your readers" → "Your books, your catalogue, your craft."
- `/account/settings`: `SharingToggle` removed; Card subtitle now *"Yours to export or
  delete. We never share it with authors or third parties."*
- `/account/delete`: "consistent with our first covenant" → "required by law".
- `/account/deleted`: "Read our covenants" link removed.
- `/admin/transparency`: "Covenant deadline" → "Publication deadline".
- `/for-authors/dashboard/pool`: "covenant-bound" / "Covenant footer" neutralised.
- Author tutorial step "You own your readers" → "Aggregated reader analytics" with body:
  *"Total purchases, country-level breakdowns, and reading completion rates. Reader identity
  stays private; you see the numbers, not the names. That is the contract with our readers
  and we hold it."*
- Reader tutorial "Five promises" step → "Your reading is yours" linking to `/legal/privacy`.

Code-comment covenant references in `lib/data/**`, `components/reader/**`, various API route
files, and `app/listen/[slug]/page.tsx` were renamed to neutral "policy" language in the
same commit. Typecheck clean.

### `penworth-store` @ `fefbe2d` — column-drop hygiene

After the main rework, a handful of files still referenced the `share_email_with_authors`
column we were about to drop:

- `app/api/account/reader-settings/route.ts` — **deleted** (its only caller,
  `SharingToggle`, was already gone).
- `app/transparency/page.tsx` — removed the dead `optedInReaders` count and `sharingRate`
  (computed but never rendered; pure dead code).
- `app/admin/readers/[readerId]/page.tsx` — removed the "Share email with authors" IdField
  display.
- `lib/data/admin-readers.ts` — stripped the field from type definition, SELECT query, and
  return mapping.
- `app/api/stripe/webhook/route.ts` — updated the stray comment about the column.

### `penworth-new` @ `51c70f0` — writer landing

- Writer landing benefit "Your own readers" → "Distribution included" with body
  *"Published to the Penworth Store and to seventeen other platforms the same day, if you
  ask. No extra services, no separate contract."* (en + ar)
- Arabic version in literary MSA: الأيادي السبعة (corrected from الأيدي السَّبع per
  Founder's direct instruction on both the plural form and the feminine number
  inflection).

### Database migration: `drop_reader_privacy_vestiges`

Applied in Supabase project `lodupspxdvadamrqvkje`.

```sql
ALTER TABLE public.store_readers   DROP COLUMN IF EXISTS share_email_with_authors;
ALTER TABLE public.store_purchases DROP COLUMN IF EXISTS reader_pseudonym;

COMMENT ON TABLE public.store_readers IS
  'Reader accounts. PII stays here. Authors NEVER have SELECT access...';
COMMENT ON TABLE public.store_purchases IS
  'Purchase records. Authors can SELECT rows for their own listings... reader_id is
   exposed only as an opaque UUID — it cannot be resolved to PII because store_readers
   RLS blocks authors. Never add columns that identify readers (name, email, pseudonym,
   IP, etc.) to this table.';
```

Audit_log entry written with `severity=critical`,
`action='schema_migration.drop_reader_privacy_vestiges'`.

Data at drop time: 1 reader row (Founder), 0 purchases, 0 opt-ins, 0 populated pseudonyms
— clean pre-launch slate.

## What the RLS posture is today

- **`store_readers`**: `readers_self_select` (user can read own row), `readers_self_update`
  (user can update own row), `admins read all store_readers` (store admins only). **Authors
  have zero access.** The previous CSV export only worked because the deleted
  `lib/data/author-readers.ts` used `createServiceClient()` to bypass RLS entirely.
- **`store_purchases`**: readers can SELECT their own rows; authors can SELECT rows for
  their own listings (`purchases_author_select` policy). `reader_id` is exposed only as an
  opaque UUID that cannot be resolved to PII because of the store_readers RLS above.
  `reader_pseudonym` column is gone.

## Verification

- **penworth-new** deploy `51c70f0`: READY in production.
- **penworth-store** deploy `fefbe2d`: READY in production.
- All 10 language landings are on their latest SHAs (from the earlier copy rewrite); none
  were touched by this arc.
- Supabase advisors: no new warnings introduced by the migration. Pre-existing WARN-level
  items (function search_path mutable ×23, pg_trgm in public schema, WITH CHECK (true) on
  public-insert tables, rls_enabled_no_policy ×6 on deny-by-default tables) remain as
  documented backlog — none are privacy-critical.

## Note on task codes

Commit messages reference **CEO-014**. That code was already taken for "Store v2 full
catalogue seeding (20 founder-picked books)" — I conflated tasks. The permanent orchestration
record is **CEO-030** with title "Privacy correction — remove reader-ownership promise +
covenant framing." Status: `done`. Both task codes refer to the same arc; the git log prose
describes scope precisely either way.

## What's still on the backlog (not part of this arc, for the record)

- **CEO-013** — Native-speaker review for the 10 language landings (blocked pending Founder
  to name reviewers per language).
- Advisor backlog — function search_path fixes, pg_trgm relocation, tighter WITH CHECK on
  public-insert policies. None privacy-critical.
- **CEO-020** DR drill, **CEO-016** Mentor UI, **CEO-005** Recipients CRUD, **CEO-019** load
  test, **CEO-027** bulk-ack UI, **CEO-008/009** pipeline bugs.

## For next session

Open `ceo-state.md` to pick the next priority. This arc is closed.
