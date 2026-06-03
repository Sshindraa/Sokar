/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {
    esmExternals: 'loose',
  },
  // Désactivé : le VPS n'a pas d'accès à fonts.gstatic.com
  optimizeFonts: false,
  // Désactivé : sharp non disponible sur le VPS
  images: {
    unoptimized: true,
  },
};

module.exports = nextConfig;
