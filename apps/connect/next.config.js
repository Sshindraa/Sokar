/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Sokar Connect est servi par un Node Next standalone derrière Nginx
  // (cf. spec connect-v1.1 §3.3 hébergement). PAS static export.
  output: 'standalone',
  // Pas de basePath global (cf. spec v1.1 §2.1) : le reverse-proxy route
  // /r/*, /restaurants/*, /sitemap.xml, /robots.txt vers ce serveur.
  poweredByHeader: false,
  assetPrefix: '/connect-assets',
  // Sécurité — headers ajoutés via middleware.ts (CSP/HSTS/Stripe-frame-blockers).
  // next.config ne les porte pas car ils dépendent du contexte request.
  images: {
    // Pas d'optimisation Next/Image : on sert des URLs externes (Cloudinary, etc.).
    // L'optimisation est gérée par le CDN upstream (Cloudflare).
    unoptimized: true,
    // Domaines autorisés pour les <Image src="https://..."> externes.
    remotePatterns: [
      { protocol: 'https', hostname: 'res.cloudinary.com' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'sokar.app' },
    ],
  },
  // Server Actions : allowedOrigins est auto-détecté en Next 15.
};

module.exports = nextConfig;
