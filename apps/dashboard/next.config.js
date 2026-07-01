const { withSentryConfig } = require('@sentry/nextjs');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Désactivé : sharp non disponible sur le VPS
  images: {
    unoptimized: true,
  },
};

module.exports = withSentryConfig(
  nextConfig,
  {
    silent: true,
    org: 'sokar',
    project: 'dashboard',
  },
  {
    widenClientFileUpload: true,
    transpileClientSDK: false,
    tunnelRoute: '/monitoring',
    hideSourceMaps: true,
    disableLogger: true,
    automaticVercelCronInstrumentation: true,
  },
);
