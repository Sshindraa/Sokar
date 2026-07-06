const { withSentryConfig } = require('@sentry/nextjs');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Désactivé : sharp non disponible sur le VPS
  images: {
    unoptimized: true,
  },
  // parallelServerBuildTraces: true — parallélise le tracing sur 2 cores.
  // (Les build traces prenaient 1 min 37 s en séquentiel sur le VPS HDD.)
  experimental: {
    parallelServerBuildTraces: true,
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
