/** Freeze the exact onboarding condition; arbitrary prose never authorizes a charge. */
export function snapshotCancellationPolicy(specials: unknown, version: string) {
  const settings =
    specials && typeof specials === 'object' && !Array.isArray(specials)
      ? (specials as Record<string, unknown>)
      : {};
  const text =
    typeof settings.cancellationPolicy === 'string'
      ? settings.cancellationPolicy.trim().slice(0, 280)
      : '';
  // Exact existing onboarding presets only. Custom terms require restaurant review.
  const hours = [2, 24, 48].find(
    (value) => text === `Annulation gratuite jusqu'à ${value} heures avant le service.`,
  );
  return {
    // Retain the historical numeric field for existing consumers. It authorizes
    // nothing unless selfService explicitly permits free_before_deadline.
    freeUntilMinutesBefore: hours === undefined ? 120 : hours * 60,
    feeCurrency: 'EUR',
    version,
    source: 'onboarding-v1',
    selfService:
      hours !== undefined && settings.depositRequired !== true ? 'free_before_deadline' : 'contact',
    terms: text || 'Conditions à vérifier auprès du restaurant.',
  };
}
