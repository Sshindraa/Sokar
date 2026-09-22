import Link from 'next/link';
import { Activity, ArrowUpRight, BarChart3, Radio, Route } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const adminAreas = [
  {
    href: '/admin/margin',
    title: 'Coûts opérationnels',
    description: 'Suivre le coût observé, la marge calculable et les corrections par restaurant.',
    icon: BarChart3,
  },
  {
    href: '/admin/health',
    title: 'Santé des restaurants',
    description: 'Contrôler les numéros, les derniers appels, les SMS et les workers.',
    icon: Activity,
  },
  {
    href: '/admin/provisioning',
    title: 'Provisioning',
    description: 'Préparer les numéros, webhooks, renvois et appels de validation.',
    icon: Radio,
  },
  {
    href: '/admin/onboarding',
    title: 'Onboarding — cohorte',
    description: "Mesurer l'abandon par étape et le délai jusqu'à la première réservation.",
    icon: Route,
  },
] as const;

export default function AdminHomePage() {
  return (
    <div className="space-y-8">
      <header className="max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Interne Sokar
        </p>
        <h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">
          Piloter Sokar sans entrer dans un restaurant
        </h2>
        <p className="mt-3 text-base text-muted-foreground">
          Cet espace regroupe les opérations qui concernent plusieurs établissements. Les données de
          coûts, de santé et de provisioning restent réservées à l’équipe Sokar.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {adminAreas.map(({ href, title, description, icon: Icon }) => (
          <Link key={href} href={href} className="group block">
            <Card className="h-full transition-all duration-200 group-hover:-translate-y-0.5 group-hover:border-primary/50">
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <ArrowUpRight
                    className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </div>
                <CardTitle className="pt-2 text-lg">{title}</CardTitle>
                <CardDescription>{description}</CardDescription>
              </CardHeader>
              <CardContent className="text-xs font-medium text-primary">
                Ouvrir la vue →
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="rounded-2xl border border-border bg-card/60 p-5 text-sm text-muted-foreground">
        <p className="font-semibold text-foreground">Séparation des espaces</p>
        <p className="mt-1">
          Le dashboard restaurant reste dédié à l’exploitation d’un établissement. Aucun montant de
          coût, quota interne ou état fournisseur n’est affiché dans cet espace client.
        </p>
      </div>
    </div>
  );
}
