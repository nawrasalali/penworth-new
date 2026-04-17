'use client';

import { useEffect, useState } from 'react';
import { X, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';

interface Metadata {
  title: string;
  subtitle: string | null;
  author_name: string;
  author_bio: string | null;
  short_description: string | null;
  long_description: string | null;
  keywords: string[];
  bisac_codes: string[];
  price_usd: number | null;
  is_free: boolean;
  territories: 'worldwide' | 'us_only' | 'custom';
  language: string;
  publication_date: string | null;
  audience: 'adult' | 'ya' | 'middle_grade' | 'children' | null;
  contains_explicit: boolean;
}

/**
 * Canonical publishing-metadata editor. One form the author fills once;
 * every publish tier reads from it. Ebook-only, so NO ISBN field exists.
 */
export function MetadataEditor({
  projectId,
  onClose,
  onSaved,
}: {
  projectId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [m, setM] = useState<Metadata | null>(null);
  const [keywordInput, setKeywordInput] = useState('');
  const [bisacInput, setBisacInput] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const resp = await fetch(`/api/publishing/metadata?projectId=${projectId}`);
        const data = await resp.json();
        if (data.metadata) setM(data.metadata);
      } catch {
        toast.error('Failed to load publishing details');
      } finally {
        setLoading(false);
      }
    })();
  }, [projectId]);

  const save = async () => {
    if (!m) return;
    setSaving(true);
    try {
      const resp = await fetch('/api/publishing/metadata', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, ...m }),
      });
      const data = await resp.json();
      if (!resp.ok || data.error) {
        toast.error(data.error || 'Save failed');
        return;
      }
      onSaved();
    } catch {
      toast.error('Save failed');
    } finally {
      setSaving(false);
    }
  };

  const addKeyword = () => {
    const v = keywordInput.trim();
    if (!v || !m) return;
    if (m.keywords.length >= 7) {
      toast.error('Maximum 7 keywords');
      return;
    }
    setM({ ...m, keywords: [...m.keywords, v] });
    setKeywordInput('');
  };

  const addBisac = () => {
    const v = bisacInput.trim().toUpperCase();
    if (!v || !m) return;
    if (m.bisac_codes.length >= 3) {
      toast.error('Maximum 3 BISAC codes');
      return;
    }
    setM({ ...m, bisac_codes: [...m.bisac_codes, v] });
    setBisacInput('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-background rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b">
          <div>
            <h2 className="text-lg font-bold">Publishing details</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Written once, applied to every platform.
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-5 space-y-4">
          {loading || !m ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <Field label="Title" required>
                <input
                  type="text"
                  value={m.title}
                  onChange={(e) => setM({ ...m, title: e.target.value })}
                  maxLength={200}
                  className="w-full px-3 py-2 border rounded-md bg-background"
                />
              </Field>

              <Field label="Subtitle">
                <input
                  type="text"
                  value={m.subtitle || ''}
                  onChange={(e) => setM({ ...m, subtitle: e.target.value })}
                  maxLength={200}
                  className="w-full px-3 py-2 border rounded-md bg-background"
                />
              </Field>

              <Field label="Author name" required>
                <input
                  type="text"
                  value={m.author_name}
                  onChange={(e) => setM({ ...m, author_name: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md bg-background"
                />
              </Field>

              <Field label="Author bio">
                <textarea
                  value={m.author_bio || ''}
                  onChange={(e) => setM({ ...m, author_bio: e.target.value })}
                  rows={2}
                  maxLength={1000}
                  className="w-full px-3 py-2 border rounded-md bg-background resize-none"
                />
              </Field>

              <Field
                label="Description"
                required
                hint="Your sales pitch. First sentence should hook; rest can explain. Used on Amazon, Kobo, Apple etc."
              >
                <textarea
                  value={m.long_description || ''}
                  onChange={(e) => setM({ ...m, long_description: e.target.value })}
                  rows={6}
                  maxLength={4000}
                  className="w-full px-3 py-2 border rounded-md bg-background resize-none text-sm"
                />
                <div className="text-right text-xs text-muted-foreground mt-1">
                  {(m.long_description || '').length} / 4000
                </div>
              </Field>

              <Field label="Keywords" hint="Up to 7 search terms. KDP and Kobo use these for discovery.">
                <div className="flex flex-wrap gap-2 mb-2">
                  {m.keywords.map((k, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-muted"
                    >
                      {k}
                      <button
                        onClick={() => setM({ ...m, keywords: m.keywords.filter((_, idx) => idx !== i) })}
                        className="hover:text-red-600"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={keywordInput}
                    onChange={(e) => setKeywordInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addKeyword())}
                    placeholder={m.keywords.length >= 7 ? 'Max 7 keywords' : 'Add a keyword and press Enter'}
                    disabled={m.keywords.length >= 7}
                    className="flex-1 px-3 py-2 border rounded-md bg-background text-sm"
                  />
                  <button
                    onClick={addKeyword}
                    disabled={!keywordInput.trim() || m.keywords.length >= 7}
                    className="px-3 py-2 rounded-md border text-sm hover:bg-muted disabled:opacity-50"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </Field>

              <Field
                label="BISAC category codes"
                hint={
                  <>
                    Up to 3. Industry-standard categories. Browse at{' '}
                    <a
                      href="https://bisg.org/page/BISACEdition"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                    >
                      bisg.org
                    </a>
                    .
                  </>
                }
              >
                <div className="flex flex-wrap gap-2 mb-2">
                  {m.bisac_codes.map((c, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-muted font-mono"
                    >
                      {c}
                      <button
                        onClick={() => setM({ ...m, bisac_codes: m.bisac_codes.filter((_, idx) => idx !== i) })}
                        className="hover:text-red-600"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={bisacInput}
                    onChange={(e) => setBisacInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addBisac())}
                    placeholder={m.bisac_codes.length >= 3 ? 'Max 3 codes' : 'e.g. FIC027000 (romance)'}
                    disabled={m.bisac_codes.length >= 3}
                    className="flex-1 px-3 py-2 border rounded-md bg-background text-sm font-mono"
                  />
                  <button
                    onClick={addBisac}
                    disabled={!bisacInput.trim() || m.bisac_codes.length >= 3}
                    className="px-3 py-2 rounded-md border text-sm hover:bg-muted disabled:opacity-50"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Price (USD)">
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={m.price_usd ?? ''}
                      onChange={(e) =>
                        setM({ ...m, price_usd: e.target.value === '' ? null : parseFloat(e.target.value) })
                      }
                      min={0}
                      step={0.01}
                      disabled={m.is_free}
                      placeholder="9.99"
                      className="w-full px-3 py-2 border rounded-md bg-background disabled:opacity-50"
                    />
                  </div>
                  <label className="flex items-center gap-2 mt-2 text-sm">
                    <input
                      type="checkbox"
                      checked={m.is_free}
                      onChange={(e) =>
                        setM({ ...m, is_free: e.target.checked, price_usd: e.target.checked ? 0 : m.price_usd })
                      }
                    />
                    Publish for free
                  </label>
                </Field>

                <Field label="Territory rights">
                  <select
                    value={m.territories}
                    onChange={(e) => setM({ ...m, territories: e.target.value as Metadata['territories'] })}
                    className="w-full px-3 py-2 border rounded-md bg-background"
                  >
                    <option value="worldwide">Worldwide</option>
                    <option value="us_only">United States only</option>
                    <option value="custom">Custom (editable per-platform)</option>
                  </select>
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Audience">
                  <select
                    value={m.audience || 'adult'}
                    onChange={(e) => setM({ ...m, audience: e.target.value as Metadata['audience'] })}
                    className="w-full px-3 py-2 border rounded-md bg-background"
                  >
                    <option value="adult">Adult</option>
                    <option value="ya">Young Adult</option>
                    <option value="middle_grade">Middle Grade</option>
                    <option value="children">Children</option>
                  </select>
                </Field>

                <Field label="Publication date" hint="Leave empty for 'publish now'.">
                  <input
                    type="date"
                    value={m.publication_date || ''}
                    onChange={(e) => setM({ ...m, publication_date: e.target.value || null })}
                    className="w-full px-3 py-2 border rounded-md bg-background"
                  />
                </Field>
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={m.contains_explicit}
                  onChange={(e) => setM({ ...m, contains_explicit: e.target.checked })}
                />
                Contains explicit content (required by some stores)
              </label>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4 border-t">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm hover:bg-muted"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving || !m}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Saving...
              </>
            ) : (
              'Save details'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </label>
      {children}
      {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
    </div>
  );
}
