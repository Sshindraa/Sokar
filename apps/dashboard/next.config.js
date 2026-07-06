const { withSentryConfig } = require('@sentry/nextjs');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Désactivé : sharp non disponible sur le VPS
  images: {
    unoptimized: true,
  },
  // Les build traces (.nft.json) prennent ~1 min 37 s sur le VPS HDD (2 CPUs).
  // parallelServerBuildTraces: true parallélise le tracing sur plusieurs cores.
  // outputFileTracingRoot: pointe vers la racine du monorepo pour éviter
  // que Next.js remonte trop haut dans l'arbre (gain sur le scan filesystem).
  experimental: {
    parallelServerBuildTraces: true,
    outputFileTracingRoot: __dirname,
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
