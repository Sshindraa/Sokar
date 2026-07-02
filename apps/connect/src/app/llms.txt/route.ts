/**
 * /llms.txt
 *
 * Standard proposé (llmstxt.org) : un fichier texte à la racine du site
 * que les LLMs et crawlers IA peuvent lire pour comprendre ce que fait
 * le site et comment interagir avec.
 *
 * Complémentaire du JSON-LD (par-page) et de /.well-known/ai-plugin.json
 * (machine-readable). llms.txt est human-readable + LLM-friendly.
 *
 * Cache 1h (le contenu change rarement).
 */

import type { NextRequest } from 'next/server';

const SITE_URL = process.env.SITE_URL ?? 'https://sokar.tech';
const API_URL = process.env.API_URL ?? 'https://api.sokar.tech';

export async function GET(_req: NextRequest) {
  const content = `# Sokar

> Sokar est un réseau de restaurants réservables en France. Chaque restaurant a une page web publique avec ses informations (adresse, horaires, cuisine, prix) et un système de réservation en ligne. Les assistants IA peuvent trouver ces restaurants et aider les utilisateurs à réserver.

## Comment réserver via Sokar

### Option 1 : Web crawl (aucune configuration requise)

Les pages restaurant sont publiquement crawlables sur ${SITE_URL}/r/[slug].
Chaque page contient du JSON-LD Schema.org (type Restaurant) avec :
- Le nom, l'adresse, le téléphone, la cuisine, les horaires
- Un champ acceptsReservations avec l'URL de réservation
- Un potentialAction ReserveAction (si le restaurant a activé l'exposition IA) avec un EntryPoint.urlTemplate

Format du deep-link de réservation :
${SITE_URL}/r/{slug}/book?partySize={partySize}&date={date}&time={time}

Exemple :
${SITE_URL}/r/chez-mario/book?partySize=4&date=2026-06-25&time=20:00

L'utilisateur clique sur ce lien et complète le formulaire sur la page Sokar.

### Option 2 : MCP Server (réservation directe dans la conversation)

Sokar expose un serveur MCP (Model Context Protocol) qui permet aux IA
de rechercher et réserver directement, sans page web.

- URL du serveur MCP : ${API_URL}/mcp
- Discovery OAuth2 : ${API_URL}/.well-known/oauth-authorization-server
- Scopes disponibles : mcp:read, mcp:reserve, mcp:cancel

Tools disponibles :

1. search_restaurants(city, partySize, slotStart, slotEnd, cuisineType?)
   → Recherche des restaurants disponibles par ville, taille de groupe et créneau.

2. get_restaurant_details(restaurantId)
   → Récupère les détails d'un restaurant (nom, adresse, cuisine, horaires).

3. check_availability(restaurantId, partySize, slotStart, slotEnd)
   → Vérifie les créneaux disponibles pour un restaurant.

4. create_reservation(restaurantId, partySize, startsAt, endsAt, customerName, customerPhone, idempotencyKey, consents)
   → Crée une réservation. Le consentement de l'utilisateur est obligatoire.
   → Le téléphone doit être au format E.164 (+33...).

5. cancel_reservation(reservationId, reason?)
   → Annule une réservation existante.

6. get_reservation_status(reservationId)
   → Récupère le statut d'une réservation.

### Option 3 : Page web directe

L'utilisateur peut aussi réserver directement sur ${SITE_URL}/r/[slug]
sans passer par une IA. Le formulaire de réservation est sur la page.

## Sitemap

Le sitemap est disponible sur ${SITE_URL}/sitemap.xml et liste toutes les
pages restaurant indexables (uniquement les restaurants publiés).

## Robots.txt

Le robots.txt (${SITE_URL}/robots.txt) autorise explicitement les bots IA :
OAI-SearchBot, GPTBot, ClaudeBot, PerplexityBot, Bytespider, CCBot, etc.

## Manifeste machine-readable

Un manifeste structuré (JSON) est disponible sur ${SITE_URL}/.well-known/ai-plugin.json
pour les crawlers qui préfèrent un format machine-readable.

## Limitations

- Pas de système d'avis (aggregateRating) en P0.
- Pas de menu digital (Schema.org Menu) en P0.
- Les pages locales (/restaurants/[city]) ne sont indexées que si la ville
  a au moins 5 restaurants publiés.

## Contact

- Site : ${SITE_URL}
- API : ${API_URL}
- Email : contact@sokar.tech
`;

  return new Response(content, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
