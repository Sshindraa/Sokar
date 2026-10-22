/**
 * Sokar Connect — cases de consentement marketing.
 *
 * Jamais pré-cochées, séparées des conditions de réservation, sans effet sur la réservation.
 * Une case n'apparaît que lorsque la coordonnée correspondante est saisie. Le texte vient de
 * @sokar/shared : c'est le même que celui conservé comme preuve par l'API.
 */
import { buildMarketingConsentLabel, type MarketingConsentChannel } from '@sokar/shared';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isConsentEmailUsable(email: string): boolean {
  return EMAIL_PATTERN.test(email.trim());
}

export type MarketingConsentChoice = Record<MarketingConsentChannel, boolean>;

export function MarketingConsentFields({
  restaurantName,
  email,
  phone,
  choice,
  onChange,
  disabled = false,
}: {
  restaurantName: string;
  email: string;
  phone: string;
  choice: MarketingConsentChoice;
  onChange: (channel: MarketingConsentChannel, checked: boolean) => void;
  disabled?: boolean;
}) {
  const channels: MarketingConsentChannel[] = [];
  if (isConsentEmailUsable(email)) channels.push('EMAIL');
  if (phone.trim()) channels.push('SMS');
  if (channels.length === 0) return null;

  return (
    <fieldset className="space-y-3 rounded-xl border border-border p-4">
      <legend className="px-1 text-sm font-medium text-[var(--widget-primary)]">
        Offres et actualités (facultatif)
      </legend>
      {channels.map((channel) => (
        <label
          key={channel}
          className="flex items-start gap-3 text-sm text-[var(--widget-primary)]"
        >
          <input
            type="checkbox"
            name={`marketing-consent-${channel.toLowerCase()}`}
            checked={choice[channel]}
            onChange={(event) => onChange(channel, event.target.checked)}
            disabled={disabled}
            className="mt-1 h-4 w-4 shrink-0 transition-all duration-200"
          />
          <span>{buildMarketingConsentLabel(channel, restaurantName)}</span>
        </label>
      ))}
      <p className="text-xs text-muted-foreground">
        Ce choix est indépendant de votre réservation : vous pouvez réserver sans cocher ces cases.
      </p>
    </fieldset>
  );
}
