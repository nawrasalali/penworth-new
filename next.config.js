/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // playwright-core pulls in chromium-bidi, electron, .ttf, and .html
  // assets that webpack can't bundle. It runs on the Node runtime only
  // (Penworth Computer routes) and must be loaded via require() at
  // runtime, not bundled. Marking it external here tells Next to leave
  // it alone during the server build.
  //
  // Note: this key was `experimental.serverComponentsExternalPackages`
  // in Next 14. Next 15 moved it to top-level `serverExternalPackages`
  // as a stable API.
  serverExternalPackages: ['playwright-core', 'playwright', 'pdfkit'],
  // pdfkit ships .afm (Adobe Font Metrics) files for its 14 built-in
  // fonts at node_modules/pdfkit/js/data/. pdfkit reads them at runtime
  // via fs.readFileSync(path.resolve(__dirname, 'data', name + '.afm')).
  //
  // Webpack-bundling pdfkit breaks this two ways:
  //   1. The .afm files aren't traced as deps → not copied to bundle
  //   2. Even if they were, pdfkit's __dirname resolves to the webpack
  //      chunk directory (/var/task/.next/server/chunks/), not the real
  //      node_modules/pdfkit/js/, so it looks in chunks/data/*.afm
  //
  // Fix: mark pdfkit as a server-external package. Next will leave it
  // as a `require('pdfkit')` at runtime. __dirname resolves to the real
  // node_modules/pdfkit/js/ and the .afm files are found. Same pattern
  // already used for playwright.
  //
  // outputFileTracingIncludes below is belt-and-braces: when a package
  // is external, Next's standalone build should auto-include it, but
  // explicit include guarantees the data files ship regardless of how
  // node_modules tracing evolves.
  outputFileTracingIncludes: {
    '/api/export': ['./node_modules/pdfkit/js/data/**/*'],
    '/api/admin/reports/monthly-investor': ['./node_modules/pdfkit/js/data/**/*'],
    '/api/admin/reports/quarterly-board': ['./node_modules/pdfkit/js/data/**/*'],
    '/api/admin/reports/dd-data-room': ['./node_modules/pdfkit/js/data/**/*'],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Additional belt-and-braces: treat these as commonjs externals so
      // webpack emits `require('playwright-core')` instead of trying to
      // walk the dep tree. Needed because API routes use playwright via
      // lib/publishing/computer-runtime.ts.
      config.externals = config.externals || [];
      config.externals.push({
        'playwright-core': 'commonjs playwright-core',
        playwright: 'commonjs playwright',
        'chromium-bidi': 'commonjs chromium-bidi',
        electron: 'commonjs electron',
      });
    }
    return config;
  },
  async redirects() {
    return [
      // Marketplace → Publish rebrand. Keep old detail links working.
      { source: '/marketplace', destination: '/publish', permanent: false },
      { source: '/marketplace/:path*', destination: '/publish/store/:path*', permanent: false },
    ];
  },
  // CTO security pass (2026-04-27): baseline browser security headers.
  // CSP is intentionally in REPORT-ONLY mode for the first deploy so we can
  // observe what the writer app actually loads (Inngest, Stripe, Supabase,
  // Anthropic-via-server, ElevenLabs, Cartesia, Voyage, fal.ai assets via
  // server proxy, computer-use UI streams) without breaking the editor or
  // the 7-agent pipeline. After 1-2 weeks of clean reports we flip to
  // enforcing Content-Security-Policy.
  async headers() {
    const securityHeaders = [
      { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=(), payment=(self)' },
      {
        key: 'Content-Security-Policy-Report-Only',
        value: [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://*.vercel-insights.com https://va.vercel-scripts.com",
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "img-src 'self' data: blob: https://*.supabase.co https://imagedelivery.net",
          "font-src 'self' data: https://fonts.gstatic.com",
          "media-src 'self' blob: data: https://*.supabase.co https://*.elevenlabs.io",
          "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.stripe.com https://*.elevenlabs.io https://*.inngest.com https://*.vercel-insights.com",
          "frame-src 'self' https://js.stripe.com https://hooks.stripe.com",
          "frame-ancestors 'self'",
          "form-action 'self' https://checkout.stripe.com",
          "base-uri 'self'",
          "object-src 'none'",
          "upgrade-insecure-requests",
        ].join('; '),
      },
    ];
    return [
      { source: '/:path*', headers: securityHeaders },
    ];
  },
}

module.exports = nextConfig
