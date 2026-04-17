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

TOOLS YOU HAVE:
- computer: mouse + keyboard + scroll, as usual.
- upload_file: the CORRECT way to attach the manuscript or cover. DO NOT try
  to drag-and-drop files or simulate a file dialog via mouse clicks — the
  browser has no filesystem you can reach. Instead, locate the
  <input type="file"> element (often hidden behind a styled label/button) and
  call upload_file with a CSS selector pointing at it, plus the attachment
  name. If the input is hidden, selector 'input[type=file]' usually works
  because upload_file attaches the file directly to the input element, which
  triggers the same change event a manual user click would.
- request_user_input: pause for a 2FA code, email verification link, or any
  human-only decision.
- report_completion: call ONCE when the upload is fully submitted.

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

ATTACHMENTS (use the upload_file tool to attach these; do not try to open
a file dialog manually):
  - attachment_name: "manuscript"  (DOCX of the full book, ~10-100 KB)
  - attachment_name: "cover"       (JPG cover image, may be absent)

STEPS (high-level; adapt if Kobo's UI differs):
  1. Go to https://writinglife.kobo.com and log in with the email/password above
  2. Click "Create New eBook" (or similar — UI may have moved)
  3. Fill in Title, Language, Description
  4. Enter Author name(s)
  5. When you reach the manuscript upload step, call upload_file with
     attachment_name="manuscript" and a selector for the file input
  6. When you reach the cover step, call upload_file with
     attachment_name="cover" and the cover file input's selector
  7. Choose categories (BISAC) + keywords
  8. Set price + territories
  9. Accept the one-time content agreement for this book
  10. Submit for publishing review
  11. Call report_completion with the book's management URL
`.trim();

  return {
    systemPrompt,
    userGoal,
    loginUrl: 'https://writinglife.kobo.com',
  };
}
