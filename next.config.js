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
}

module.exports = nextConfig
