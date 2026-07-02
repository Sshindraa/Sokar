/**
 * /.well-known/ai-plugin.json
 *
 * Standard émergent pour la discovery IA (similaire à ai-plugin.json
 * d'OpenAI plugins). Décrit les capabilities de Sokar pour les crawlers
 * IA qui cherchent un manifeste structuré.
 *
 * Ce fichier est complémentaire du JSON-LD (qui est par-page) et du
 * llms.txt (qui est human-readable). Il est machine-readable.
 *
 * Pas d'auth, pas de PII. Cache 1h.
 */

import type { NextRequest } from 'next/server';

const SITE_URL = process.env.SITE_URL ?? 'https://sokar.tech';
const API_URL = process.env.API_URL ?? 'https://api.sokar.tech';

export async function GET(_req: NextRequest) {
  const manifest = {
    schema_version: '1.0',
    name: 'Sokar',
    description:
      'Réseau de restaurants réservables en France. Trouvez et réservez une table en ligne ou via votre assistant IA.',
    url: SITE_URL,
    contact_email: 'contact@sokar.tech',
    capabilities: {
      // Web crawl : les pages /restaurant/[slug] sont publiquement crawlables
      // et contiennent du JSON-LD Schema.org Restaurant + ReserveAction.
      web_crawl: {
        enabled: true,
        sitemap: `${SITE_URL}/sitemap.xml`,
        robots_txt: `${SITE_URL}/robots.txt`,
        json_ld_schema: 'https://schema.org/Restaurant',
        reservation_schema: 'https://schema.org/ReserveAction',
        // Format du deep-link de réservation (pré-rempli par l'IA)
        booking_url_template: `${SITE_URL}/restaurant/{slug}/book?partySize={partySize}&date={date}&time={time}`,
      },
      // MCP : les IA qui supportent le Model Context Protocol peuvent
      // appeler directement les tools de réservation.
      mcp: {
        enabled: true,
        server_url: `${API_URL}/mcp`,
        oauth_discovery: `${API_URL}/.well-known/oauth-authorization-server`,
        scopes: ['mcp:read', 'mcp:reserve', 'mcp:cancel'],
        tools: [
          {
            name: 'search_restaurants',
            description: 'Search restaurants by city, party size, and time',
          },
          { name: 'get_restaurant_details', description: 'Get restaurant details by ID' },
          {
            name: 'check_availability',
            description: 'Check availability for a party size and time slot',
          },
          { name: 'create_reservation', description: 'Create a reservation (requires consent)' },
          { name: 'cancel_reservation', description: 'Cancel a reservation by ID' },
          { name: 'get_reservation_status', description: 'Get reservation status by ID' },
        ],
      },
    },
    // Comment un client final peut réserver
    user_flows: {
      // Flow 1 : l'IA trouve le resto via crawl et donne un lien (aucune config)
      web: "L'utilisateur demande à son IA, qui trouve le restaurant sur Sokar et propose un lien de réservation pré-rempli. L'utilisateur clique et confirme sur la page.",
      // Flow 2 : l'IA réserve directement via MCP (API key requise, pour clients MCP)
      mcp: "L'utilisateur demande à son IA, qui réserve directement via le protocole MCP. Nécessite une API key Sokar (attribution par contact@sokar.tech). Aucune page web nécessaire.",
      // Flow 3 : l'utilisateur va directement sur la page
      direct:
        "L'utilisateur va sur sokar.tech/restaurant/[restaurant] et réserve via le formulaire en ligne.",
    },
  };

  return new Response(JSON.stringify(manifest, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
