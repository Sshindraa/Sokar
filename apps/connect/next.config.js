/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Sokar Connect est servi par un Node Next standalone derrière Nginx
  // (cf. spec connect-v1.1 §3.3 hébergement). PAS static export.
  output: 'standalone',
  // Pas de basePath global (cf. spec v1.1 §2.1) : le reverse-proxy route
  // /restaurant/*, /restaurants/*, /sitemap.xml, /robots.txt vers ce serveur.
  poweredByHeader: false,
  assetPrefix: '/connect-assets',
  // Redirect de sécurité : /r/[slug](/book) → /restaurant/[slug](/book).
  // L'ancien préfixe /r/ a été renommé en /restaurant/ (cohérence URL).
  // Redirect permanent (308) : aucun contenu indexé sous /r/ en prod, mais
  // protège si un lien /r/ a fuité dans un cache IA ou un bookmark.
  async redirects() {
    return [
      {
        source: '/r/:slug*',
        destination: '/restaurant/:slug*',
        permanent: true,
      },
    ];
  },
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
    ],
  },
  // Server Actions : allowedOrigins est auto-détecté en Next 15.
  // parallelServerBuildTraces: true — parallélise le tracing sur 2 cores.
  experimental: {
    parallelServerBuildTraces: true,
  },
  // ESLint est déjà exécuté en pre-push hook (prepush-quality-gate).
  // Le relancer pendant next build sur le VPS ajoute ~68 s de linting redondant.
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
};

module.exports = nextConfig;
