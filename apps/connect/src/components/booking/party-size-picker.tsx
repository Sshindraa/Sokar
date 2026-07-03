/**
 * Sokar Connect — PartySizePicker.
 *
 * Select dropdown pour le nombre de personnes (1-12).
 */

const PARTY_SIZES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export function PartySizePicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div>
      <label htmlFor="partySize" className="block text-sm font-medium text-[var(--widget-primary)]">
        Nombre de personnes
      </label>
      <select
        id="partySize"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[var(--widget-primary)] focus:border-[var(--widget-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--widget-accent)]"
      >
        {PARTY_SIZES.map((n) => (
          <option key={n} value={n}>
            {n} {n === 1 ? 'personne' : 'personnes'}
          </option>
        ))}
      </select>
    </div>
  );
}
