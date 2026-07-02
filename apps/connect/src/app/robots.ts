/**
 * Sokar Connect — robots.txt dynamique.
 *
 * Cf. spec connect-v1.1 §11.
 *
 * - Allow / pour tous les bots (incl. bots IA : OAI-SearchBot, GPTBot,
 *   ClaudeBot, PerplexityBot, Bytespider, etc.)
 * - Allow pages publiques
 * - Disallow /admin, /dashboard, /api (pas exposés, mais ceinture+bretelles)
 * - Référence le sitemap
 *
 * Bots IA explicitement allowed (discovery web crawl) :
 * - OAI-SearchBot : ChatGPT Search (OpenAI)
 * - GPTBot        : OpenAI training + inference
 * - ClaudeBot     : Anthropic (Claude)
 * - anthropic-ai  : Anthropic (alias)
 * - PerplexityBot : Perplexity
 * - Perplexity-User : Perplexity (user-agent alternatif)
 * - Bytespider    : ByteDance (Doubao, TikTok search)
 * - CCBot         : Common Crawl (utilisé par many IA)
 * - Googlebot     : Google (Search + AI Overviews)
 * - Bingbot       : Microsoft (Bing + Copilot)
 * - Applebot      : Apple (Siri + Apple Intelligence)
 *
 * Cf. https://platform.openai.com/docs/bots
 * Cf. https://support.anthropic.com/en/articles/8896518-how-anthropic-handles-web-crawling
 * Cf. https://docs.perplexity.ai/guides/bots
 */

import type { MetadataRoute } from 'next';

const SITE_URL = process.env.SITE_URL ?? 'https://sokar.tech';

// Bots IA explicitement allowed pour le web crawl discovery.
// On les liste explicitement (même si * allow / déjà) pour signaler
// aux opérateurs IA que Sokar est volontairement crawlable.
const AI_BOTS = [
  'OAI-SearchBot', // ChatGPT Search
  'GPTBot', // OpenAI
  'ClaudeBot', // Anthropic
  'anthropic-ai', // Anthropic (alias)
  'PerplexityBot', // Perplexity
  'Perplexity-User', // Perplexity (alt)
  'Bytespider', // ByteDance / Doubao
  'CCBot', // Common Crawl
  'Googlebot', // Google
  'Bingbot', // Microsoft / Copilot
  'Applebot', // Apple / Siri
];

const ALLOW_RULE = { allow: '/', disallow: ['/admin/', '/dashboard/', '/api/'] };

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', ...ALLOW_RULE },
      // Explicit allow pour chaque bot IA (signal positif pour les opérateurs)
      ...AI_BOTS.map((ua) => ({ userAgent: ua, ...ALLOW_RULE })),
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
    // llms.txt : signal de discovery pour les LLMs (llmstxt.org)
    // Next.js ne supporte pas de champ custom dans MetadataRoute.Robots,
    // mais les crawlers IA vérifient /llms.txt à la racine automatiquement.
  };
}
