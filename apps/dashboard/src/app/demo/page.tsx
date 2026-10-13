import DemoRequestForm from '@/app/demo/DemoRequestForm';
import { DEMO_METADATA } from '@/app/marketing-metadata';

export const metadata = DEMO_METADATA;

export default function DemoPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-4 pb-16 pt-32 sm:px-6">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        Démonstration
      </p>
      <h1 className="mt-3 text-3xl font-bold tracking-tight text-foreground md:text-4xl">
        Demander une démonstration
      </h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        Présentez-nous votre restaurant : nous vous montrons Sokar sur votre situation. Aucun compte
        n’est nécessaire pour demander une démonstration.
      </p>
      <div className="mt-8 rounded-2xl border border-border bg-card p-6 sm:p-8">
        <DemoRequestForm />
      </div>
    </main>
  );
}
