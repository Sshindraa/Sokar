/**
 * Sokar Connect P2 — Custom domain resolver.
 *
 * Cette route est appelée par le middleware quand le host n'est pas sokar.tech.
 * Elle fait le lookup DB (customDomain → slug) et render la page restaurant.
 *
 * Le middleware rewrite silencieusement / → /custom-domain?host=reserve.chezmario.fr
 * et cette page fetch l'API pour résoudre le slug, puis render la page restaurant.
 */

import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

async function resolveCustomDomain(host: string): Promise<string | null> {
  const apiUrl = process.env.API_URL;
  if (!apiUrl) return null;
  try {
    const res = await fetch(`${apiUrl}/public/resolve-custom-domain?host=${encodeURIComponent(host)}`, {
      next: { revalidate: 300 }, // Cache 5 min — le mapping customDomain → slug change rarement
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { slug: string | null };
    return data.slug;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ host?: string }>;
}): Promise<Metadata> {
  const { host } = await searchParams;
  if (!host) return { title: 'Domaine non configuré' };
  const slug = await resolveCustomDomain(host);
  if (!slug) {
    return {
      title: 'Domaine non configuré',
      description: 'Ce domaine n’est pas encore configuré. Contactez le restaurant.',
      robots: { index: false, follow: false },
    };
  }
  // La page restaurant gère son propre metadata, ici on retourne un fallback.
  return {
    title: 'Réservation',
    robots: { index: true, follow: true },
  };
}

export default async function CustomDomainPage({
  searchParams,
}: {
  searchParams: Promise<{ host?: string }>;
}) {
  const { host } = await searchParams;
  if (!host) notFound();

  const slug = await resolveCustomDomain(host);
  if (!slug) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-8">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-bold text-foreground">Domaine non configuré</h1>
          <p className="mt-4 text-muted-foreground">
            Ce domaine n’est pas encore actif. Si vous êtes le restaurateur, vérifiez la
            configuration dans votre dashboard Sokar. Si le problème persiste, contactez le
            support.
          </p>
        </div>
      </main>
    );
  }

  // Redirect vers la page restaurant (le middleware aura déjà rewrite,
  // mais on veut que l'URL affichée reste le custom domain).
  // On render la page restaurant en important son composant.
  const { default: RestaurantPage } = await import('../restaurant/[slug]/page');
  return await RestaurantPage({
    params: Promise.resolve({ slug }),
    searchParams: Promise.resolve({}),
  });
}
