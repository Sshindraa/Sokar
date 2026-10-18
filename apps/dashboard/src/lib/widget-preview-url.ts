export function buildWidgetPreviewUrl(slug: string, primary: string, accent: string): string {
  const params = new URLSearchParams({
    embedded: '1',
    primary: primary.replace('#', ''),
    accent: accent.replace('#', ''),
  });

  return `/widget/${encodeURIComponent(slug)}?${params.toString()}`;
}
