/**
 * Sokar Connect — SlotGrid.
 *
 * Grille de créneaux horaires. L'utilisateur clique sur un slot
 * disponible pour passer à l'étape suivante.
 */

type Slot = { time: string; available: boolean };

export function SlotGrid({ slots, onSelect }: { slots: Slot[]; onSelect: (time: string) => void }) {
  if (slots.length === 0) return null;

  return (
    <div>
      <h3 className="mb-2 text-sm font-medium text-[var(--widget-primary)]">
        Choisissez un horaire
      </h3>
      <div
        role="group"
        aria-label="Créneaux horaires disponibles"
        className="grid grid-cols-3 gap-2 sm:grid-cols-4"
      >
        {slots.map((slot) => (
          <button
            key={slot.time}
            type="button"
            aria-label={`Créneau à ${slot.time}`}
            aria-pressed={slot.available ? false : undefined}
            aria-disabled={!slot.available ? true : undefined}
            disabled={!slot.available}
            onClick={() => onSelect(slot.time)}
            className={`rounded-lg border px-3 py-2 text-sm font-medium transition-all duration-200 ${
              slot.available
                ? 'border-border bg-background text-[var(--widget-primary)] hover:border-[var(--widget-accent)] hover:bg-[var(--widget-accent-light)]'
                : 'cursor-not-allowed border-border bg-muted text-muted-foreground line-through'
            }`}
          >
            {slot.time}
          </button>
        ))}
      </div>
    </div>
  );
}
