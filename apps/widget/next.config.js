/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'export',
  // Le widget est servi en static depuis un CDN (Cloudflare).
  // L'output export force la génération 100% statique.
  images: {
    unoptimized: true,
  },
};

module.exports = nextConfig;
