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
  serverExternalPackages: ['playwright-core', 'playwright'],
  // pdfkit ships .afm (Adobe Font Metrics) files for its 14 built-in
  // fonts at node_modules/pdfkit/js/data/. Webpack bundles pdfkit's JS
  // but does not detect these .afm runtime reads via fs.readFileSync,
  // so they're omitted from the Vercel serverless bundle and any
  // doc.font('Helvetica') call crashes with:
  //
  //   ENOENT: no such file or directory, open
  //   '/var/task/.next/server/chunks/data/Helvetica.afm'
  //
  // outputFileTracingIncludes forces these to ship. Applied to every
  // route that uses pdfkit: the existing /api/export + the three new
  // /api/admin/reports/* endpoints. Wildcarding by directory avoids
  // listing all 14 fonts individually.
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
