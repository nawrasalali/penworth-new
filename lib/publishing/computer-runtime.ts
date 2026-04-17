/**
 * Penworth Computer — browser runtime abstraction.
 *
 * The runtime owns a live Chromium instance that Claude's computer-use tool
 * drives. We swap implementations behind this interface without touching the
 * agent loop:
 *
 *   - browserbase: managed cloud Chromium with Playwright CDP endpoint.
 *     Preferred for production. Requires BROWSERBASE_API_KEY +
 *     BROWSERBASE_PROJECT_ID env vars.
 *   - fly: self-hosted Chromium-on-Fly-Machine. Planned.
 *   - local: null-op stub that lets routes boot cleanly in dev without a
 *     real browser. Useful for UI work.
 *
 * The agent loop talks to this interface only. It never knows whether the
 * browser is in San Francisco or on your laptop.
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';

export interface BrowserRuntime {
  sessionId: string;
  liveViewUrl: string | null;
  page: Page;
  /** Capture a PNG screenshot of the current page. */
  screenshot(): Promise<Buffer>;
  /** Viewport dimensions. Claude computer-use needs this to map coordinates. */
  viewport(): { width: number; height: number };
  /** Close the session and release the resource. */
  dispose(): Promise<void>;
}

export type RuntimeName = 'browserbase' | 'local';

const VIEWPORT = { width: 1280, height: 800 };

/**
 * Pick and launch a runtime. Defaults to browserbase when its env vars are
 * present, otherwise falls back to the local stub. Callers can force a
 * specific runtime via the `forceRuntime` argument (for testing).
 */
export async function startBrowserRuntime(opts: {
  forceRuntime?: RuntimeName;
} = {}): Promise<BrowserRuntime> {
  const forced = opts.forceRuntime;
  const hasBrowserbase = !!process.env.BROWSERBASE_API_KEY && !!process.env.BROWSERBASE_PROJECT_ID;

  if (forced === 'browserbase' || (!forced && hasBrowserbase)) {
    return startBrowserbase();
  }
  return startLocalStub();
}

// ---------- Browserbase ----------

async function startBrowserbase(): Promise<BrowserRuntime> {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID;
  if (!apiKey || !projectId) {
    throw new Error('BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID required');
  }

  // 1. Create a session via Browserbase REST API
  const createResp = await fetch('https://api.browserbase.com/v1/sessions', {
    method: 'POST',
    headers: { 'x-bb-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId,
      browserSettings: {
        viewport: VIEWPORT,
        // Block auto-close so the session survives agent turns
        blockAds: true,
      },
      // Short TTL is fine — agent sessions complete fast
      keepAlive: false,
    }),
  });

  if (!createResp.ok) {
    const text = await createResp.text().catch(() => '');
    throw new Error(`Browserbase session create failed: ${createResp.status} ${text}`);
  }

  const { id: sessionId, connectUrl } = await createResp.json() as {
    id: string;
    connectUrl: string;
  };

  // 2. Fetch a live-view URL so the UI can embed the session in an iframe
  let liveViewUrl: string | null = null;
  try {
    const liveResp = await fetch(
      `https://api.browserbase.com/v1/sessions/${sessionId}/debug`,
      { headers: { 'x-bb-api-key': apiKey } },
    );
    if (liveResp.ok) {
      const debug = await liveResp.json() as { debuggerFullscreenUrl?: string };
      liveViewUrl = debug.debuggerFullscreenUrl || null;
    }
  } catch {
    // non-fatal
  }

  // 3. Connect Playwright to the CDP WebSocket
  const browser: Browser = await chromium.connectOverCDP(connectUrl);
  const defaultCtx = browser.contexts()[0];
  const ctx: BrowserContext = defaultCtx || (await browser.newContext({ viewport: VIEWPORT }));
  const page: Page = ctx.pages()[0] || (await ctx.newPage());
  await page.setViewportSize(VIEWPORT);

  return {
    sessionId,
    liveViewUrl,
    page,
    viewport: () => VIEWPORT,
    async screenshot() {
      return await page.screenshot({ type: 'png', fullPage: false });
    },
    async dispose() {
      try {
        await browser.close();
      } catch {
        // non-fatal
      }
      // Tell Browserbase to tear down server-side
      try {
        await fetch(`https://api.browserbase.com/v1/sessions/${sessionId}`, {
          method: 'POST',
          headers: { 'x-bb-api-key': apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'REQUEST_RELEASE' }),
        });
      } catch {
        // non-fatal
      }
    },
  };
}

// ---------- Local stub ----------

/**
 * No-op browser runtime for dev environments where Browserbase isn't
 * configured. Every screenshot returns a placeholder PNG and actions are
 * swallowed. Useful for working on agent-loop logic and UI without burning
 * Browserbase minutes.
 */
async function startLocalStub(): Promise<BrowserRuntime> {
  const sessionId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  // 1x1 transparent PNG
  const placeholder = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=',
    'base64',
  );
  // We don't have a real Page — but the loop only uses .screenshot / viewport
  // from Runtime and does actions via computer-use tool commands that we
  // route through methods below. For the stub, actions no-op.
  const fakePage = new Proxy({}, {
    get() {
      return async () => undefined;
    },
  }) as unknown as Page;

  return {
    sessionId,
    liveViewUrl: null,
    page: fakePage,
    viewport: () => VIEWPORT,
    async screenshot() {
      return placeholder;
    },
    async dispose() {
      // no-op
    },
  };
}
