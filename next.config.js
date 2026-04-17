/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      // Marketplace → Publish rebrand. Keep old detail links working.
      { source: '/marketplace', destination: '/publish', permanent: false },
      { source: '/marketplace/:path*', destination: '/publish/store/:path*', permanent: false },
    ];
  },
}

module.exports = nextConfig
