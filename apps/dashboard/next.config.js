const { withSentryConfig } = require('@sentry/nextjs');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Désactivé : sharp non disponible sur le VPS
  images: {
    unoptimized: true,
  },
  // Les build traces (.nft.json) prennent ~1 min 37 s sur le VPS HDD.
  // Elles ne servent que pour Sentry / Vercel — ni l'un ni l'autre actif.
  experimental: {
    collectBuildTracing: false,
  },
};

// Sentry n'est actif que si SENTRY_AUTH_TOKEN est présent.
// En prod le token n'est pas configuré → on évite le overhead de wrapping.
const sentryEnabled = !!process.env.SENTRY_AUTH_TOKEN;

module.exports = sentryEnabled
  ? withSentryConfig(
      nextConfig,
      { silent: true, org: 'sokar', project: 'dashboard' },
      {
        widenClientFileUpload: true,
        transpileClientSDK: false,
        tunnelRoute: '/monitoring',
        hideSourceMaps: true,
        disableLogger: true,
        automaticVercelCronInstrumentation: true,
      },
    )
  : nextConfig;
