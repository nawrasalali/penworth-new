'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Task 2.4 — ArticleEditor client island.
 *
 * Handles create + edit modes for nora_kb_articles.
 *
 * Key behaviors:
 *   - surface_scope + role_scope are multi-select checkbox groups. Both
 *     must have length > 0 at save time (CHECK constraint enforced
 *     server-side; also validated here as UX).
 *   - content_markdown has a live preview using a minimal inline
 *     renderer (not a full markdown parser — we don't need to pull in
 *     remark/rehype for an admin preview).
 *   - version is displayed read-only; the server increments it on save
 *     per pre-flight A11 (monotonic counter only; no rollback in this
 *     phase — Phase 2.1 if needed).
 *   - Translation editor: per-language tab with title/summary/content
 *     fields. Save UPSERTs nora_kb_article_translations.
 *   - Tags: comma-separated chip input stored as text[].
 *   - No save-time embedding regeneration per pre-flight D1 (infra
 *     doesn't exist).
 */

type Mode = 'create' | 'edit';

interface Article {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  content_markdown: string;
  surface_scope: string[];
  role_scope: string[];
  tags: string[];
  version: number;
  published: boolean;
  is_internal: boolean;
}

interface Translation {
  id: string;
  article_id: string;
  language: string;
  title: string;
  summary: string | null;
  content_markdown: string;
  translator: string | null;
  reviewed_by_human: boolean;
}

const SURFACE_OPTIONS = ['author', 'guild', 'store', 'admin'];
const ROLE_OPTIONS = ['author', 'guild_member', 'admin', 'council', 'anonymous'];
const LANGUAGE_OPTIONS = ['en', 'ar', 'es', 'fr', 'pt', 'ru', 'zh', 'bn', 'hi', 'id', 'vi'];

export function ArticleEditor({
  mode,
  article,
  translations,
}: {
  mode: Mode;
  article?: Article;
  translations?: Translation[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Core form state
  const [slug, setSlug] = useState(article?.slug ?? '');
  const [title, setTitle] = useState(article?.title ?? '');
  const [summary, setSummary] = useState(article?.summary ?? '');
  const [content, setContent] = useState(article?.content_markdown ?? '');
  const [surfaceScope, setSurfaceScope] = useState<string[]>(
    article?.surface_scope ?? [],
  );
  const [roleScope, setRoleScope] = useState<string[]>(article?.role_scope ?? []);
  const [tagsInput, setTagsInput] = useState(
    (article?.tags ?? []).join(', '),
  );
  const [published, setPublished] = useState(article?.published ?? false);
  const [isInternal, setIsInternal] = useState(article?.is_internal ?? false);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [activeLanguage, setActiveLanguage] = useState<string | null>(null);

  function toggleArray(arr: string[], val: string): string[] {
    return arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val];
  }

  async function handleSaveArticle() {
    setError(null);
    setSuccess(null);

    // Client-side validation matching the DB's CHECK constraints.
    if (slug.trim().length === 0) return setError('slug is required');
    if (title.trim().length === 0) return setError('title is required');
    if (content.trim().length === 0) return setError('content is required');
    if (surfaceScope.length === 0) return setError('Select at least one surface');
    if (roleScope.length === 0) return setError('Select at least one role');

    setSubmitting(true);
    try {
      const tags = tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      const payload = {
        slug: slug.trim(),
        title: title.trim(),
        summary: summary.trim() || null,
        content_markdown: content,
        surface_scope: surfaceScope,
        role_scope: roleScope,
        tags,
        published,
        is_internal: isInternal,
      };

      if (mode === 'create') {
        const res = await fetch('/api/admin/kb', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `Failed (${res.status})`);
        setSuccess('Article created.');
        router.push(`/admin/kb/${json.data.id}`);
      } else {
        const res = await fetch(`/api/admin/kb/${article!.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `Failed (${res.status})`);
        setSuccess(`Saved. Now at version ${json.data.version}.`);
        startTransition(() => router.refresh());
      }
    } catch (e: any) {
      setError(e?.message || 'Save failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        {(error || success) && (
          <div
            className={`rounded-md border p-3 text-sm ${
              error
                ? 'border-red-500/40 bg-red-500/10 text-red-400'
                : 'border-green-500/40 bg-green-500/10 text-green-400'
            }`}
          >
            {error || success}
          </div>
        )}

        <label className="block">
          <span className="text-xs uppercase text-muted-foreground">Slug</span>
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="e.g. reset-my-password"
            disabled={mode === 'edit'}
            className="mt-1 w-full rounded-md border bg-background px-3 py-2 font-mono text-sm disabled:opacity-50"
          />
          {mode === 'edit' && (
            <span className="mt-1 block text-xs text-muted-foreground">
              Slug is immutable after creation.
            </span>
          )}
        </label>

        <label className="block">
          <span className="text-xs uppercase text-muted-foreground">Title</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
          />
        </label>

        <label className="block">
          <span className="text-xs uppercase text-muted-foreground">Summary</span>
          <input
            type="text"
            value={summary ?? ''}
            onChange={(e) => setSummary(e.target.value)}
            className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
          />
        </label>

        <div>
          <div className="mb-1 text-xs uppercase text-muted-foreground">
            Content (markdown)
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={22}
              className="w-full rounded-md border bg-background px-3 py-2 font-mono text-xs"
            />
            <div className="prose prose-sm max-w-none overflow-auto rounded-md border bg-muted/20 px-3 py-2">
              <SimpleMarkdownPreview source={content} />
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <div className="mb-2 text-xs uppercase text-muted-foreground">Surfaces</div>
            <div className="flex flex-wrap gap-2">
              {SURFACE_OPTIONS.map((opt) => (
                <label
                  key={opt}
                  className={`cursor-pointer rounded-md border px-3 py-1 text-xs ${
                    surfaceScope.includes(opt)
                      ? 'border-primary bg-primary/10'
                      : 'hover:bg-muted'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={surfaceScope.includes(opt)}
                    onChange={() => setSurfaceScope(toggleArray(surfaceScope, opt))}
                  />
                  {opt}
                </label>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2 text-xs uppercase text-muted-foreground">Roles</div>
            <div className="flex flex-wrap gap-2">
              {ROLE_OPTIONS.map((opt) => (
                <label
                  key={opt}
                  className={`cursor-pointer rounded-md border px-3 py-1 text-xs ${
                    roleScope.includes(opt)
                      ? 'border-primary bg-primary/10'
                      : 'hover:bg-muted'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={roleScope.includes(opt)}
                    onChange={() => setRoleScope(toggleArray(roleScope, opt))}
                  />
                  {opt}
                </label>
              ))}
            </div>
          </div>
        </div>

        <label className="block">
          <span className="text-xs uppercase text-muted-foreground">
            Tags (comma-separated)
          </span>
          <input
            type="text"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="e.g. billing, password, account"
            className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
          />
        </label>

        <div className="flex items-center gap-6 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={published}
              onChange={(e) => setPublished(e.target.checked)}
              className="h-4 w-4"
            />
            <span>Published</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={isInternal}
              onChange={(e) => setIsInternal(e.target.checked)}
              className="h-4 w-4"
            />
            <span>Internal only (visible to admins in the runbook surface)</span>
          </label>
        </div>

        <div className="flex items-center justify-between border-t pt-4">
          <div className="text-xs text-muted-foreground">
            {mode === 'edit' && article ? `Current version: v${article.version}` : 'Will save as v1'}
          </div>
          <button
            type="button"
            onClick={handleSaveArticle}
            disabled={submitting || pending}
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? 'Saving…' : mode === 'create' ? 'Create article' : 'Save new version'}
          </button>
        </div>
      </div>

      {/* Right column: translations */}
      {mode === 'edit' && article && (
        <aside className="space-y-3">
          <div className="text-xs uppercase text-muted-foreground">
            Translations
          </div>
          <div className="rounded-lg border bg-card p-3">
            <div className="mb-3 flex flex-wrap gap-1.5 text-xs">
              {LANGUAGE_OPTIONS.map((lang) => {
                const hasTranslation = (translations || []).some((t) => t.language === lang);
                const isActive = activeLanguage === lang;
                return (
                  <button
                    key={lang}
                    type="button"
                    onClick={() => setActiveLanguage(lang)}
                    className={`rounded px-2 py-1 ${
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : hasTranslation
                          ? 'bg-green-500/10 text-green-400'
                          : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {lang}
                    {hasTranslation && !isActive && ' ✓'}
                  </button>
                );
              })}
            </div>

            {activeLanguage && (
              <TranslationEditor
                articleId={article.id}
                language={activeLanguage}
                existing={(translations || []).find((t) => t.language === activeLanguage)}
                onSaved={() => {
                  startTransition(() => router.refresh());
                }}
              />
            )}
            {!activeLanguage && (
              <div className="text-xs text-muted-foreground">
                Click a language to edit its translation.
              </div>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}

function TranslationEditor({
  articleId,
  language,
  existing,
  onSaved,
}: {
  articleId: string;
  language: string;
  existing: Translation | undefined;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(existing?.title ?? '');
  const [summary, setSummary] = useState(existing?.summary ?? '');
  const [content, setContent] = useState(existing?.content_markdown ?? '');
  const [translator, setTranslator] = useState(existing?.translator ?? '');
  const [reviewed, setReviewed] = useState(existing?.reviewed_by_human ?? false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setError(null);
    if (title.trim().length === 0 || content.trim().length === 0) {
      return setError('title and content are required');
    }
    setSaving(true);
    try {
      const res = await fetch(
        `/api/admin/kb/${articleId}/translations/${language}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: title.trim(),
            summary: summary.trim() || null,
            content_markdown: content,
            translator: translator.trim() || null,
            reviewed_by_human: reviewed,
          }),
        },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Failed (${res.status})`);
      onSaved();
    } catch (e: any) {
      setError(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2 text-xs">
      {error && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 p-2 text-red-400">
          {error}
        </div>
      )}
      <label className="block">
        <span className="text-muted-foreground">Title ({language})</span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="mt-1 w-full rounded border bg-background px-2 py-1"
        />
      </label>
      <label className="block">
        <span className="text-muted-foreground">Summary</span>
        <input
          type="text"
          value={summary ?? ''}
          onChange={(e) => setSummary(e.target.value)}
          className="mt-1 w-full rounded border bg-background px-2 py-1"
        />
      </label>
      <label className="block">
        <span className="text-muted-foreground">Content (markdown)</span>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={10}
          className="mt-1 w-full rounded border bg-background px-2 py-1 font-mono"
        />
      </label>
      <label className="block">
        <span className="text-muted-foreground">Translator (optional)</span>
        <input
          type="text"
          value={translator ?? ''}
          onChange={(e) => setTranslator(e.target.value)}
          className="mt-1 w-full rounded border bg-background px-2 py-1"
        />
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={reviewed}
          onChange={(e) => setReviewed(e.target.checked)}
          className="h-3.5 w-3.5"
        />
        <span>Reviewed by human</span>
      </label>
      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="mt-2 w-full rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:opacity-90 disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save translation'}
      </button>
    </div>
  );
}

/**
 * Tiny markdown preview. NOT a full parser — just handles headings,
 * bold, italic, inline code, and paragraphs. Admin preview only; the
 * real author-facing renderer lives elsewhere.
 */
function SimpleMarkdownPreview({ source }: { source: string }) {
  if (!source.trim()) {
    return <div className="text-xs italic text-muted-foreground">Preview will appear here.</div>;
  }
  // Very small markdown subset. Split paragraphs on blank lines, render
  // inline formatting. Intentionally not using dangerouslySetInnerHTML
  // with a full parser — admin-only preview, keep it lean.
  const paragraphs = source.split(/\n\n+/);
  return (
    <div className="space-y-3 text-sm">
      {paragraphs.map((para, i) => {
        const heading = para.match(/^(#{1,6})\s+(.+)$/);
        if (heading) {
          const level = heading[1].length;
          const text = heading[2];
          const size = level <= 2 ? 'text-lg font-semibold' : level <= 4 ? 'text-base font-medium' : 'text-sm font-medium';
          return (
            <div key={i} className={size}>
              {text}
            </div>
          );
        }
        return (
          <p key={i} className="whitespace-pre-wrap">
            {inlineRender(para)}
          </p>
        );
      })}
    </div>
  );
}

function inlineRender(text: string): React.ReactNode {
  // Super-lean inline formatting: bold **x**, italic *x*, code `x`. No
  // link rendering to avoid XSS concerns in admin preview. Real render
  // uses the author-surface markdown pipeline.
  const parts: React.ReactNode[] = [];
  let i = 0;
  let last = 0;
  while (i < text.length) {
    if (text[i] === '*' && text[i + 1] === '*') {
      const close = text.indexOf('**', i + 2);
      if (close > 0) {
        if (last < i) parts.push(text.slice(last, i));
        parts.push(<strong key={i}>{text.slice(i + 2, close)}</strong>);
        i = close + 2;
        last = i;
        continue;
      }
    } else if (text[i] === '`') {
      const close = text.indexOf('`', i + 1);
      if (close > 0) {
        if (last < i) parts.push(text.slice(last, i));
        parts.push(
          <code key={i} className="rounded bg-muted px-1 font-mono text-xs">
            {text.slice(i + 1, close)}
          </code>,
        );
        i = close + 1;
        last = i;
        continue;
      }
    }
    i++;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
