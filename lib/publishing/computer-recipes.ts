/**
 * Per-platform prompt recipes for Penworth Computer.
 *
 * Each recipe builds the system prompt + user goal that Claude sees
 * when driving a browser against that platform. Claude has to be told:
 *   - where to navigate
 *   - what credentials to use (injected in-memory — never logged)
 *   - what fields exist on the form
 *   - when to hand off (2FA, CAPTCHA)
 *   - what the success state looks like
 *
 * We deliberately keep recipes descriptive rather than imperative. Claude
 * is better at high-level objectives + gentle guardrails than rigid
 * step-by-step scripts that break when a platform moves a button.
 */

import type { PublishingMetadata } from './metadata';

export interface RecipeInput {
  metadata: PublishingMetadata;
  credentials: {
    email: string;
    password: string;
  };
  attachmentBasename: string; // filename agent expects to find in downloads dir
}

export interface Recipe {
  systemPrompt: string;
  userGoal: string;
  loginUrl: string;
}

export function buildRecipe(slug: string, input: RecipeInput): Recipe | null {
  switch (slug) {
    case 'kobo':
      return koboRecipe(input);
    default:
      return null;
  }
}

function koboRecipe({ metadata, credentials }: RecipeInput): Recipe {
  const systemPrompt = `
You are Penworth's publishing robot, operating a real web browser on behalf
of an author. Your job is to publish one ebook to Kobo Writing Life.

OPERATING PRINCIPLES:
- Move deliberately. Take a screenshot and study the page before every click.
- If an element isn't where you expect, scroll or wait — pages load progressively.
- Never click "Submit" or "Publish" until every required field on the current
  page is filled with the provided metadata.
- If you see a CAPTCHA, 2FA prompt, email verification, or anything requiring
  a human, call the request_user_input tool with a clear reason.
- If you see the word "error" on screen, stop and call request_user_input.
- The author's credentials are provided for login only. Do not navigate away
  from kobo.com or writinglife.kobo.com.
- If the browser shows a cookie banner, accept essential cookies only and move on.
- When the ebook is fully submitted for review OR published, call
  report_completion with the book's Kobo URL if visible.

SAFETY:
- Never change account settings, payout details, or royalty options you
  aren't explicitly told to change.
- Never agree to Terms & Conditions unless they're the standard one-time
  acceptance for a new book upload.
- If in doubt, hand off.
`.trim();

  const userGoal = `
Publish this book to Kobo Writing Life.

CREDENTIALS (login only):
  Email: ${credentials.email}
  Password: ${credentials.password}

BOOK METADATA:
  Title: ${metadata.title}
  ${metadata.subtitle ? `Subtitle: ${metadata.subtitle}` : ''}
  Author: ${metadata.author_name}
  Language: ${metadata.language || 'English'}
  Description: ${metadata.long_description || metadata.short_description || ''}
  Price (USD): ${metadata.is_free ? 'Free' : (metadata.price_usd || 2.99)}
  Keywords: ${(metadata.keywords || []).join(', ')}
  BISAC codes: ${(metadata.bisac_codes || []).join(', ')}
  Territories: ${metadata.territories || 'worldwide'}
  Audience: ${metadata.audience || 'general'}
  Contains explicit content: ${metadata.contains_explicit ? 'yes' : 'no'}

FILES UPLOADED IN-BROWSER:
  - manuscript: manuscript.epub (or .docx) — already dropped in the downloads
    folder visible to the browser
  - cover: cover.jpg — also in downloads

STEPS (high-level; adapt if Kobo's UI differs):
  1. Go to https://writinglife.kobo.com and log in
  2. Click "Create New eBook"
  3. Fill in Title, Language, Description
  4. Enter Author name(s)
  5. Upload manuscript.epub, then cover.jpg
  6. Choose categories (BISAC) + keywords
  7. Set price + territories
  8. Accept the one-time content agreement for this book
  9. Submit for publishing review
  10. Call report_completion with the book's management URL
`.trim();

  return {
    systemPrompt,
    userGoal,
    loginUrl: 'https://writinglife.kobo.com',
  };
}
