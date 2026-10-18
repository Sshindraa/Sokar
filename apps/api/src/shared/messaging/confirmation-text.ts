import { countSmsSegments } from '../../modules/usage/messaging-usage.service';

export function buildConfirmationText(
  name: string,
  date: string,
  time: string,
  partySize: number,
  managementUrl?: string,
): string {
  const brand = name
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  const full = `Reservation confirmee - ${brand} ${date} ${time} ${partySize}pers. Annulation: appelez le restaurant.`;
  if (managementUrl) {
    const letters = [...brand];
    do {
      const label = letters.length ? ` ${letters.join('')}.` : '';
      const text = `Confirme ${date} ${time}, ${partySize}p.${label} Gerer: ${managementUrl}`;
      if (countSmsSegments(text) === 1) return text;
      letters.pop();
    } while (letters.length);
    const minimal = `Confirme ${date} ${time}, ${partySize}p. Gerer: ${managementUrl}`;
    if (countSmsSegments(minimal) === 1) return minimal;
    throw new Error('Management link exceeds confirmation SMS segment budget');
  }
  if (countSmsSegments(full) === 1) return full;

  // Preserve Unicode names rather than silently transliterating them. Shorten
  // the brand to fit the provider's real encoding-dependent segment budget.
  const letters = [...brand];
  while (letters.length) {
    const compact = `Confirme ${date} ${time} ${partySize}p. ${letters.join('')}. Modif: appelez.`;
    if (countSmsSegments(compact) === 1) return compact;
    letters.pop();
  }
  const minimal = `Reservation confirmee ${date} ${time}, ${partySize} pers. Modif: appelez le restaurant.`;
  if (countSmsSegments(minimal) !== 1) throw new Error('Confirmation SMS exceeds segment budget');
  return minimal;
}
