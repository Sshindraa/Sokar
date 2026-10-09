import { Globe, Phone, Store } from 'lucide-react';
import { SokarLogo } from '@/components/SokarLogo';
import { cn } from '@/lib/utils';
import styles from './onboarding-atmosphere.module.css';

/** Objet visuel du parcours : aucune activité ni disponibilité simulée. */
export function RestaurantIllustration() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 py-5">
      <div className="relative w-full max-w-80 px-3 pb-5">
        <div className={cn(styles.orb, styles.heroOrb, 'mx-auto flex items-center justify-center')}>
          <div className="flex flex-col items-center gap-3 px-8 text-center">
            <SokarLogo className="size-8" aria-hidden="true" />
            <p className="text-lg font-medium leading-snug tracking-tight">
              Votre accueil
              <br />
              prend forme.
            </p>
          </div>
        </div>
        <div className="absolute bottom-0 right-0 flex size-24 flex-col items-center justify-center gap-1 rounded-full border-4 border-background bg-primary text-primary-foreground">
          <Globe size={18} aria-hidden="true" />
          <p className="text-center text-[11px] font-medium leading-tight">
            Sokar
            <br />
            Connect
          </p>
        </div>
      </div>
      <div className="flex flex-wrap justify-center gap-2 text-xs text-muted-foreground">
        {[
          { icon: Phone, label: 'Téléphone' },
          { icon: Globe, label: 'En ligne' },
          { icon: Store, label: 'Sur place' },
        ].map(({ icon: Icon, label }) => (
          <span
            key={label}
            className="inline-flex items-center gap-1.5 rounded-full bg-card px-3 py-2.5"
          >
            <Icon size={12} aria-hidden="true" /> {label}
          </span>
        ))}
      </div>
    </div>
  );
}
