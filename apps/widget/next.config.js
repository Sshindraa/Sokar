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

// NEXT_PUBLIC_API_URL doit être défini au build time (baked dans le bundle static).
// Ex: https://api.sokar.tech en prod, http://localhost:4100 en dev.

module.exports = nextConfig;
