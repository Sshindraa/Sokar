export const SUPPERNOTE_DEMO_SLUG = 'chez-suppernote-demo';
const STORED_DEMO_SLUG = 'chez-sokar-demo';

export function resolveDemoSlug(slug: string): string {
  return slug === SUPPERNOTE_DEMO_SLUG ? STORED_DEMO_SLUG : slug;
}

/** Explicit seed fixtures, never a name or prefix heuristic. Keep their direct test pages accessible. */
export const CONNECT_DEMO_SLUGS = [
  STORED_DEMO_SLUG,
  'chez-sokar-bouchon-lyon',
  'chez-sokar-italien-lyon',
  'chez-sokar-sushi-lyon',
  'chez-sokar-terrasse-lyon',
  'chez-sokar-bistrot-paris',
  'chez-sokar-neo-paris',
  'chez-sokar-ramen-paris',
  'chez-sokar-tapas-paris',
  'chez-sokar-veggie-paris',
] as const;

export function isConnectDemoSlug(slug: string): boolean {
  return (CONNECT_DEMO_SLUGS as readonly string[]).includes(slug);
}
