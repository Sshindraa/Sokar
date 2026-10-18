import { Check, Minus } from 'lucide-react';
import {
  CATALOG_FEATURES,
  PLAN_ORDER,
  planIncludes,
  type CatalogFeature,
} from '@/app/pricing-catalog';
import { cn } from '@/lib/utils';

/**
 * Tableau comparatif des formules. Chaque cellule dit si la fonctionnalité est incluse, et son statut :
 * inclus, ou « Bientôt » si elle n'est pas encore livrée. Le statut se lit en texte, pas seulement en couleur.
 */
export default function PlanComparison() {
  return (
    <section aria-labelledby="plan-comparison-title" className="w-full space-y-6">
      <div className="space-y-2">
        <h3 id="plan-comparison-title" className="text-xl font-semibold tracking-tight text-white">
          Comparer les formules
        </h3>
        <p className="text-sm leading-relaxed text-white/50">
          Bientôt : en cours de développement, sans date garantie. Tout le reste est disponible
          aujourd’hui.
        </p>
      </div>

      <div className="overflow-x-auto rounded-[2rem] border border-white/15 bg-white/[0.04]">
        <table className="w-full border-collapse text-left text-sm md:min-w-[36rem]">
          <caption className="sr-only">Fonctionnalités par formule, avec leur statut</caption>
          <thead>
            <tr className="border-b border-white/10">
              <th scope="col" className="p-3 font-semibold text-white/70 md:p-4">
                Fonctionnalité
              </th>
              {PLAN_ORDER.map((plan) => (
                <th key={plan} scope="col" className="p-3 font-semibold text-white md:p-4">
                  {plan}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CATALOG_FEATURES.map((feature) => (
              <tr key={feature.id} className="border-b border-white/10 last:border-0">
                <th scope="row" className="p-3 font-medium text-white/80 md:p-4">
                  {feature.label}
                </th>
                {PLAN_ORDER.map((plan) => (
                  <td key={plan} className="p-3 align-top md:p-4">
                    <FeatureCell feature={feature} included={planIncludes(plan, feature)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FeatureCell({ feature, included }: { feature: CatalogFeature; included: boolean }) {
  if (!included) {
    return (
      <span className="inline-flex items-center text-white/30">
        <Minus size={14} aria-hidden="true" />
        <span className="sr-only">Non inclus</span>
      </span>
    );
  }

  const available = feature.status === 'disponible';
  return (
    <span className="inline-flex items-center gap-2 text-white/80">
      <Check
        size={14}
        aria-hidden="true"
        className={cn(available ? 'text-pricing-accent' : 'text-white/30')}
      />
      {available ? (
        <span className="sr-only">Inclus</span>
      ) : (
        <span className="text-xs font-semibold text-white/50">Bientôt</span>
      )}
    </span>
  );
}
