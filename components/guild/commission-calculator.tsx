'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';

type PlanKey = 'pro' | 'max';
type Period = 'monthly' | 'annual';

type Tier = {
  name: string;
  rate: number;
  color: string;
  hint: string;
};

// Canonical — app/guild/ladder/page.tsx + lib/guild/commissions.ts
const TIERS: Tier[] = [
  { name: 'Apprentice', rate: 0.20, color: '#a8a295', hint: 'First rung.' },
  { name: 'Journeyman', rate: 0.25, color: '#c4a57a', hint: 'Earning stripes.' },
  { name: 'Artisan',    rate: 0.30, color: '#d4af37', hint: 'Established.' },
  { name: 'Master',     rate: 0.35, color: '#e6c14a', hint: 'Vote on the roadmap.' },
  { name: 'Fellow',     rate: 0.40, color: '#f2d36e', hint: 'Lifetime honour.' },
];

// Canonical — lib/guild/commissions.ts planPriceUsd()
const PLANS: Record<PlanKey, { label: string; price: number }> = {
  pro: { label: 'Pro', price: 19 },
  max: { label: 'Max', price: 49 },
};

export default function CommissionCalculator() {
  // Defaults per Founder: Artisan, 300 authors, Max
  const [tierIdx, setTierIdx] = useState<number>(2);
  const [authors, setAuthors] = useState<number>(300);
  const [plan, setPlan] = useState<PlanKey>('max');
  const [period, setPeriod] = useState<Period>('monthly');
  const [displayAmount, setDisplayAmount] = useState<number>(0);
  const [dragging, setDragging] = useState<boolean>(false);

  const tier = TIERS[tierIdx];
  const rate = tier.rate;
  const price = PLANS[plan].price;

  const monthly = authors * price * rate;
  const annual = monthly * 12;
  const primary = period === 'monthly' ? monthly : annual;
  const pct = authors / 1000;

  const raf = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (raf.current !== undefined) cancelAnimationFrame(raf.current);
    const start = displayAmount;
    const t0 = performance.now();
    const dur = 500;
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplayAmount(start + (primary - start) * eased);
      if (p < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current !== undefined) cancelAnimationFrame(raf.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primary]);

  const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

  const milestone = useMemo(() => {
    const y = annual;
    if (y < 600) return 'Room to grow.';
    if (y < 6000) return 'Pocket money — for now.';
    if (y < 25000) return 'A reliable side income.';
    if (y < 60000) return 'Replaces a part-time job.';
    if (y < 100000) return 'Full-time Guild territory.';
    if (y < 250000) return "Six figures. You've built a following.";
    return 'Top of the ladder.';
  }, [annual]);

  // --- Vertical slider: custom pointer-event handling for identical desktop/mobile behaviour ---
  const sliderRef = useRef<HTMLDivElement | null>(null);

  const updateFromClientY = useCallback((clientY: number) => {
    const el = sliderRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const raw = 1 - (clientY - rect.top) / rect.height;
    const clamped = Math.max(0, Math.min(1, raw));
    setAuthors(Math.round(clamped * 1000));
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
    setDragging(true);
    updateFromClientY(e.clientY);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    updateFromClientY(e.clientY);
  };
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    setDragging(false);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) {}
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 50 : 10;
    const big = 100;
    let handled = true;
    setAuthors((a) => {
      switch (e.key) {
        case 'ArrowUp': case 'ArrowRight': return Math.min(1000, a + step);
        case 'ArrowDown': case 'ArrowLeft': return Math.max(0, a - step);
        case 'PageUp':   return Math.min(1000, a + big);
        case 'PageDown': return Math.max(0, a - big);
        case 'Home':     return 0;
        case 'End':      return 1000;
        default: handled = false; return a;
      }
    });
    if (handled) e.preventDefault();
  };

  return (
    <>
      <link
        href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght,SOFT,WONK@0,9..144,300..800,0..100,0..1;1,9..144,300..700,0..100,0..1&display=swap"
        rel="stylesheet"
      />
      <style>{`
        .gc-root { color: #e7e2d4; font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; }
        .gc-serif { font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; }
        .gc-serif-wonk { font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'opsz' 144, 'SOFT' 100, 'WONK' 1; }
        .gc-panel {
          background: linear-gradient(to bottom right, #0f1424, #0a0e1a);
          border: 1px solid rgba(212,175,55,0.2);
          border-radius: 16px;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.02), 0 40px 120px -40px rgba(0,0,0,0.7);
        }
        .gc-gold { color: #d4af37; }
        .gc-dim { color: #c9c2b0; }
        .gc-mute { color: #8a8370; }
        .gc-dimmer { color: #6b6452; }
        .gc-overline { letter-spacing: 0.22em; text-transform: uppercase; font-size: 10px; color: #8a8370; font-weight: 500; }
        .gc-rule { background: linear-gradient(to right, transparent 0%, rgba(212,175,55,0.25) 20%, rgba(212,175,55,0.25) 80%, transparent 100%); height: 1px; }

        .gc-vslider {
          position: relative;
          width: 48px;
          height: clamp(220px, 58vw, 280px);
          flex-shrink: 0;
          touch-action: none;
          outline: none;
          cursor: grab;
          -webkit-tap-highlight-color: transparent;
          user-select: none;
          -webkit-user-select: none;
        }
        .gc-vslider:active { cursor: grabbing; }
        .gc-vslider:focus-visible { box-shadow: 0 0 0 2px rgba(212,175,55,0.5); border-radius: 999px; }
        .gc-vslider-track {
          position: absolute; left: 50%; top: 0; bottom: 0;
          width: 20px; margin-left: -10px;
          background: #141a2a;
          border: 1px solid #1e2436;
          border-radius: 999px;
          overflow: hidden;
          pointer-events: none;
        }
        .gc-vslider-fill {
          position: absolute; left: 0; right: 0; bottom: 0;
          background: linear-gradient(to top, #b8941f 0%, #d4af37 60%, #f2d36e 100%);
          border-radius: 999px;
          box-shadow: 0 0 22px rgba(212,175,55,0.35);
          pointer-events: none;
        }
        .gc-vslider-thumb {
          position: absolute; left: 50%;
          width: 44px; height: 44px;
          margin-left: -22px;
          border-radius: 50%;
          background: radial-gradient(circle at 32% 30%, #f6dc85 0%, #d4af37 55%, #a67f14 100%);
          border: 3px solid #0a0e1a;
          box-shadow:
            0 0 0 1px #d4af37,
            0 6px 22px rgba(212,175,55,0.5),
            inset 0 2px 4px rgba(255,255,255,0.3),
            inset 0 -2px 4px rgba(0,0,0,0.25);
          pointer-events: none;
          transition: transform .12s ease, box-shadow .12s ease;
        }
        .gc-vslider.is-dragging .gc-vslider-thumb {
          transform: scale(1.08);
          box-shadow: 0 0 0 1px #f2d36e, 0 8px 30px rgba(212,175,55,0.7),
            inset 0 2px 4px rgba(255,255,255,0.4), inset 0 -2px 4px rgba(0,0,0,0.25);
        }
        .gc-vticks {
          position: absolute; right: -26px; top: 0; bottom: 0;
          display: flex; flex-direction: column; justify-content: space-between;
          pointer-events: none;
          font-size: 10px; letter-spacing: 0.1em; color: #6b6452;
        }

        .gc-tier-pill { background: #141a2a; border: 1px solid #1e2436; color: #c9c2b0; transition: all .2s ease; cursor: pointer; -webkit-tap-highlight-color: transparent; }
        .gc-tier-pill:hover { border-color: #3a4259; color: #e7e2d4; }
        .gc-tier-pill.active { color: #0a0e1a; transform: translateY(-2px); box-shadow: 0 10px 30px -10px rgba(212,175,55,0.45); }

        .gc-plan-btn { background: #141a2a; border: 1px solid #2a3149; color: #c9c2b0; transition: all .15s ease; cursor: pointer; text-align: left; -webkit-tap-highlight-color: transparent; }
        .gc-plan-btn:hover { border-color: #3a4259; color: #e7e2d4; }
        .gc-plan-btn.active { background: #d4af37; color: #0a0e1a; border-color: #d4af37; }

        .gc-toggle-btn { letter-spacing: 0.22em; text-transform: uppercase; font-size: 11px; padding: 4px 2px; background: transparent; border: none; cursor: pointer; -webkit-tap-highlight-color: transparent; }
        .gc-toggle-btn.active { color: #d4af37; border-bottom: 1px solid #d4af37; }
        .gc-toggle-btn.inactive { color: #8a8370; border-bottom: 1px solid transparent; }

        .gc-cta { background: #d4af37; color: #0a0e1a; transition: background .2s ease; }
        .gc-cta:hover { background: #e6c14a; }

        @keyframes gc-fade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        .gc-fade { animation: gc-fade 0.45s ease; }

        @keyframes gc-ping { 75%, 100% { transform: scale(2); opacity: 0; } }
        .gc-ping { animation: gc-ping 2s cubic-bezier(0,0,0.2,1) infinite; }
      `}</style>

      <div className="gc-root">
        <div className="gc-panel p-5 sm:p-8 relative overflow-hidden">

          {/* Badge */}
          <div className="flex items-center gap-3 mb-4">
            <span className="relative flex" style={{ height: '8px', width: '8px' }}>
              <span className="gc-ping absolute inline-flex h-full w-full rounded-full" style={{ background: '#d4af37', opacity: 0.75 }} />
              <span className="relative inline-flex rounded-full" style={{ height: '8px', width: '8px', background: '#d4af37' }} />
            </span>
            <span className="gc-overline gc-gold">Estimate your commission</span>
          </div>

          <h3 className="gc-serif font-normal leading-none tracking-tight" style={{ fontSize: 'clamp(1.5rem, 4.5vw, 2.1rem)' }}>
            From paid{' '}
            <em className="gc-gold gc-serif-wonk" style={{ fontWeight: 400 }}>customers</em>
            <span className="gc-gold">.</span>
          </h3>
          <p className="gc-dim mt-3 max-w-md leading-relaxed" style={{ fontSize: 'clamp(0.82rem, 2.5vw, 0.95rem)' }}>
            A share of every author you introduce to Penworth — for twelve months from their first paid month.
          </p>

          {/* Hero */}
          <div className="mt-7 mb-7 flex items-center gap-4 sm:gap-6">
            <div className="flex-1 min-w-0">
              <div
                className="gc-serif font-normal tabular-nums tracking-tight leading-none"
                style={{ fontSize: 'clamp(2.2rem, 10vw, 4.2rem)', color: '#e7e2d4', wordBreak: 'break-word' }}
              >
                <span className="gc-mute mr-1" style={{ fontSize: '0.42em', verticalAlign: 'top' }}>$</span>
                {fmt(displayAmount)}
              </div>

              <div className="mt-3 flex gap-5 items-center flex-wrap">
                <button type="button" onClick={() => setPeriod('monthly')} className={`gc-toggle-btn ${period === 'monthly' ? 'active' : 'inactive'}`}>per month</button>
                <button type="button" onClick={() => setPeriod('annual')} className={`gc-toggle-btn ${period === 'annual' ? 'active' : 'inactive'}`}>per year</button>
              </div>

              <div className="gc-mute mt-3" style={{ fontSize: '11px', fontStyle: 'italic' }}>
                {period === 'monthly' ? `≈ $${fmt(annual)} / year` : `≈ $${fmt(monthly)} / month`}
              </div>
              <div className="mt-1" style={{ fontSize: '11px', color: tier.color, letterSpacing: '0.05em' }}>
                {Math.round(rate * 100)}% · {tier.name}
              </div>

              <div
                className="gc-serif italic mt-3 gc-fade"
                key={milestone}
                style={{ color: tier.color, fontSize: 'clamp(0.85rem, 2.6vw, 1rem)' }}
              >
                {milestone}
              </div>
            </div>

            <div className="flex flex-col items-center gap-2 flex-shrink-0">
              <div className="gc-serif tabular-nums leading-none" style={{ fontSize: '1.25rem', color: '#e7e2d4' }}>
                {authors}
              </div>
              <div className="gc-overline" style={{ fontSize: '9px' }}>authors</div>

              <div
                ref={sliderRef}
                className={`gc-vslider ${dragging ? 'is-dragging' : ''}`}
                role="slider"
                tabIndex={0}
                aria-valuemin={0}
                aria-valuemax={1000}
                aria-valuenow={authors}
                aria-label="Paying authors you introduce"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onKeyDown={onKeyDown}
              >
                <div className="gc-vslider-track"></div>
                <div
                  className="gc-vslider-fill"
                  style={{ height: `calc(22px + (100% - 44px) * ${pct})` }}
                ></div>
                <div
                  className="gc-vslider-thumb"
                  style={{ bottom: `calc((100% - 44px) * ${pct})` }}
                ></div>
                <div className="gc-vticks">
                  <span>1K</span>
                  <span>500</span>
                  <span>0</span>
                </div>
              </div>
            </div>
          </div>

          <div className="gc-rule my-6"></div>

          {/* Tier */}
          <div className="mb-6">
            <div className="flex items-baseline justify-between mb-3">
              <span className="gc-overline">Your tier</span>
              <span className="gc-mute gc-serif" style={{ fontSize: '11px', fontStyle: 'italic' }}>{tier.hint}</span>
            </div>
            <div className="grid grid-cols-5 gap-1 sm:gap-1.5">
              {TIERS.map((t, i) => (
                <button
                  type="button"
                  key={t.name}
                  onClick={() => setTierIdx(i)}
                  className={`gc-tier-pill ${tierIdx === i ? 'active' : ''} text-center`}
                  style={{
                    borderRadius: '3px',
                    background: tierIdx === i ? t.color : '#141a2a',
                    borderColor: tierIdx === i ? t.color : '#1e2436',
                    padding: '10px 2px',
                    minHeight: '56px',
                  }}
                >
                  <div className="gc-serif leading-none" style={{ fontSize: 'clamp(0.62rem, 2vw, 0.75rem)' }}>
                    {t.name}
                  </div>
                  <div className="mt-1.5" style={{ fontSize: '10px', letterSpacing: '0.08em', opacity: tierIdx === i ? 0.8 : 0.6 }}>
                    {Math.round(t.rate * 100)}%
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Plan */}
          <div className="mb-6">
            <div className="gc-overline mb-2">Their plan</div>
            <div className="grid grid-cols-2 gap-2">
              {(Object.entries(PLANS) as [PlanKey, { label: string; price: number }][]).map(([k, v]) => (
                <button
                  type="button"
                  key={k}
                  onClick={() => setPlan(k)}
                  className={`gc-plan-btn ${plan === k ? 'active' : ''}`}
                  style={{ borderRadius: '3px', padding: '12px 14px', minHeight: '56px' }}
                >
                  <div className="gc-serif leading-none" style={{ fontSize: '1rem' }}>{v.label}</div>
                  <div className="mt-1.5" style={{ fontSize: '11px', letterSpacing: '0.05em', opacity: plan === k ? 0.8 : 0.65 }}>
                    ${v.price} / month
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="gc-rule my-6"></div>

          {/* Breakdown */}
          <div className="mb-7 space-y-3" style={{ fontSize: 'clamp(0.8rem, 2.5vw, 0.88rem)' }}>
            <div className="flex justify-between items-baseline gap-2">
              <span className="gc-mute">{authors} × ${price} × {Math.round(rate * 100)}%</span>
              <span className="tabular-nums gc-serif" style={{ fontSize: '1rem', color: '#e7e2d4' }}>${fmt(monthly)}</span>
            </div>
            <div className="gc-rule" style={{ margin: '12px 0' }}></div>
            <div className="flex justify-between items-baseline gap-2">
              <span className="gc-serif" style={{ fontSize: 'clamp(0.95rem, 2.8vw, 1.1rem)', color: '#e7e2d4' }}>Monthly total</span>
              <span className="gc-serif tabular-nums gc-gold" style={{ fontSize: 'clamp(1.25rem, 4vw, 1.5rem)' }}>${fmt(monthly)}</span>
            </div>
            <div className="flex justify-between items-baseline gc-mute gap-2" style={{ fontSize: '11px' }}>
              <span style={{ fontStyle: 'italic' }}>Over twelve months, if every author stays</span>
              <span className="tabular-nums">${fmt(annual)}</span>
            </div>
          </div>

          {/* CTA */}
          <a
            href="/guild/apply"
            className="gc-cta block text-center gc-serif tracking-wide"
            style={{
              fontSize: 'clamp(0.95rem, 2.8vw, 1.05rem)',
              borderRadius: '3px',
              textDecoration: 'none',
              fontWeight: 500,
              padding: '14px 18px',
            }}
          >
            Apply to the Guild <span style={{ marginLeft: '6px' }}>→</span>
          </a>

          <p className="gc-dimmer mt-4 leading-relaxed" style={{ fontSize: '11px', fontStyle: 'italic' }}>
            Illustrative figures. Rate locks at your tier at referral time; earnings run for twelve months per referral.
          </p>
        </div>
      </div>
    </>
  );
}
