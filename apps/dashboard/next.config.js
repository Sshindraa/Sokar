const { withSentryConfig } = require('@sentry/nextjs');
const createNextIntlPlugin = require('next-intl/plugin');

// next-intl 4 a besoin d'un plugin Next pour inliner les messages dans le
// bundle client. On pointe vers `src/i18n/request.ts` qui est l'entrée
// `getRequestConfig` documentée par next-intl pour App Router. La locale se
// résout côté serveur (pas de segment [locale], pas de middleware de
// réécriture) — cf. apps/dashboard/src/i18n/config.ts.
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Désactivé : sharp non disponible sur le VPS
  images: {
    unoptimized: true,
  },
  // parallelServerBuildTraces: true — parallélise le tracing sur 2 cores.
  // (Les build traces prenaient 1 min 37 s en séquentiel sur le VPS HDD.)
  // webpackBuildWorker: true — requis pour que parallelServerBuildTraces
  // s'active (Next 15 désactive le build worker dès qu'un plugin modifie
  // la config webpack, ce qui est le cas de next-intl/plugin).
  experimental: {
    parallelServerBuildTraces: true,
    webpackBuildWorker: true,
  },
  // ESLint est déjà exécuté en pre-push hook (prepush-quality-gate).
  // Le relancer pendant next build sur le VPS ajoute ~40 s (dashboard) + ~68 s
  // (connect) de linting redondant. On le désactive sur le build de prod.
  // Le typecheck reste actif (ignoreBuildErrors: false) — safety net.
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
};

// Sentry n'est actif que si SENTRY_AUTH_TOKEN est présent.
// En prod le token n'est pas configuré → on évite le overhead de wrapping.
const sentryEnabled = !!process.env.SENTRY_AUTH_TOKEN;

module.exports = sentryEnabled
  ? withSentryConfig(
      withNextIntl(nextConfig),
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
  : withNextIntl(nextConfig);
