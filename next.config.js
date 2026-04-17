/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // playwright-core pulls in chromium-bidi, electron, .ttf, and .html
    // assets that webpack can't bundle. It runs on the Node runtime only
    // (Penworth Computer routes) and must be loaded via require() at
    // runtime, not bundled. Marking it external here tells Next to leave
    // it alone during the server build.
    serverComponentsExternalPackages: ['playwright-core', 'playwright'],
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
