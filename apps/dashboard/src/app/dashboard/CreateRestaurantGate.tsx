'use client';

import { useState, FormEventHandler } from 'react';
import { useAuth, useOrganization, useOrganizationList } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { ArrowRight, ChefHat, Loader2, AlertCircle } from 'lucide-react';

const hasClerkKey = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

/**
 * CreateRestaurantGate — si l'utilisateur est connecté sans organisation
 * active, on affiche un écran "Créez votre restaurant" qui crée l'org Clerk
 * puis laisse SyncOrganization créer le restaurant en DB.
 *
 * Sans clé Clerk (dev preview), le gate est transparent.
 */
export function CreateRestaurantGate({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  const { organization } = useOrganization();

  // Pas de Clerk → on rend le dashboard directement (mode démo locale)
  if (!hasClerkKey) return <>{children}</>;

  // Clerk pas encore chargé → on attend
  if (!isLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Pas connecté → le middleware redirige vers /login, on ne devrait pas
  // arriver ici, mais on rend quand même le dashboard par sécurité.
  if (!isSignedIn) return <>{children}</>;

  // Connecté avec org active → on rend le dashboard
  if (organization) return <>{children}</>;

  // Connecté sans org active → on affiche le gate
  return <CreateRestaurantForm />;
}

function CreateRestaurantForm() {
  const router = useRouter();
  const { isLoaded, createOrganization, setActive } = useOrganizationList();
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate: FormEventHandler<HTMLFormElement> = async (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Veuillez saisir le nom de votre restaurant.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const newOrg = await createOrganization?.({ name: trimmed });
      if (newOrg) {
        await setActive?.({ organization: newOrg.id });
        // SyncOrganization se déclenche automatiquement au prochain render
        router.refresh();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur lors de la création.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  if (!isLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-background p-6">
      {/* Atmosphère */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,hsl(var(--foreground)/0.08),transparent_50%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(hsl(var(--border)/0.12)_1px,transparent_1px),linear-gradient(90deg,hsl(var(--border)/0.10)_1px,transparent_1px)] bg-[length:72px_72px] opacity-50" />

      <div className="relative z-10 w-full max-w-md">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center gap-3">
          <Image src="/logo-nav.png" alt="Sokar" width={48} height={48} className="h-12 w-12" />
          <span className="text-xl font-bold tracking-tight text-foreground font-display">
            Sokar
          </span>
        </div>

        <div className="rounded-2xl border border-border bg-card/80 backdrop-blur-xl p-8 shadow-2xl">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-border bg-secondary/50">
              <ChefHat size={22} className="text-muted-foreground" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Créez votre restaurant</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {'Donnez un nom à votre établissement pour configurer votre espace Sokar.'}
            </p>
          </div>

          {/* Formulaire de création */}
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <label
                htmlFor="restaurant-name"
                className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Nom du restaurant
              </label>
              <input
                id="restaurant-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex : Bistrot L'Ardoise"
                disabled={loading}
                autoFocus
                className="flex h-11 w-full rounded-lg border border-input bg-background/50 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-all duration-200 disabled:opacity-50"
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !name.trim()}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-primary-foreground transition-all duration-200 hover:bg-primary/95 active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Création…
                </>
              ) : (
                <>
                  Créer mon restaurant
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          {'Vous pourrez modifier ces informations plus tard dans les paramètres.'}
        </p>
      </div>
    </div>
  );
}
