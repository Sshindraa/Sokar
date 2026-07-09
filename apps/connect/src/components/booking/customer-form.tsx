/**
 * Sokar Connect — CustomerForm.
 *
 * Formulaire de coordonnées client (prénom, téléphone, email,
 * demandes spéciales) + honeypot anti-bot.
 */

export function CustomerForm({
  firstName,
  setFirstName,
  phone,
  setPhone,
  email,
  setEmail,
  specialRequests,
  setSpecialRequests,
  honeypot,
  setHoneypot,
}: {
  firstName: string;
  setFirstName: (v: string) => void;
  phone: string;
  setPhone: (v: string) => void;
  email: string;
  setEmail: (v: string) => void;
  specialRequests: string;
  setSpecialRequests: (v: string) => void;
  honeypot: string;
  setHoneypot: (v: string) => void;
}) {
  return (
    <>
      <div>
        <label
          htmlFor="firstName"
          className="block text-sm font-medium text-[var(--widget-primary)]"
        >
          Prénom *
        </label>
        <input
          id="firstName"
          type="text"
          required
          aria-required="true"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[var(--widget-primary)] focus:border-[var(--widget-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--widget-accent)]"
          autoComplete="given-name"
          maxLength={100}
        />
      </div>

      <div>
        <label htmlFor="phone" className="block text-sm font-medium text-[var(--widget-primary)]">
          Téléphone *
        </label>
        <span id="phone-hint" className="mt-0.5 block font-normal text-muted-foreground">
          format international
        </span>
        <input
          id="phone"
          type="tel"
          required
          aria-required="true"
          aria-describedby="phone-hint"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+33612345678"
          className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[var(--widget-primary)] focus:border-[var(--widget-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--widget-accent)]"
          autoComplete="tel"
        />
      </div>

      <div>
        <label htmlFor="email" className="block text-sm font-medium text-[var(--widget-primary)]">
          Email{' '}
          <span className="font-normal text-muted-foreground">(optionnel, pour confirmation)</span>
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[var(--widget-primary)] focus:border-[var(--widget-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--widget-accent)]"
          autoComplete="email"
        />
      </div>

      <div>
        <label
          htmlFor="specialRequests"
          className="block text-sm font-medium text-[var(--widget-primary)]"
        >
          Demandes spéciales <span className="font-normal text-muted-foreground">(optionnel)</span>
        </label>
        <textarea
          id="specialRequests"
          value={specialRequests}
          onChange={(e) => setSpecialRequests(e.target.value)}
          rows={2}
          maxLength={500}
          className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[var(--widget-primary)] focus:border-[var(--widget-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--widget-accent)]"
        />
      </div>

      {/* Honeypot — invisible, leave empty (bots fill all inputs) */}
      <div className="hidden" aria-hidden="true">
        <label htmlFor="website">Website</label>
        <input
          id="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={honeypot}
          onChange={(e) => setHoneypot(e.target.value)}
        />
      </div>
    </>
  );
}
