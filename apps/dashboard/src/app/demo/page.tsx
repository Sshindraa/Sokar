import { Mail } from 'lucide-react';
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
      <p className="mt-6 text-center text-sm leading-6 text-muted-foreground">
        Vous préférez nous écrire ?{' '}
        <a
          href="mailto:hello@sokar.tech"
          className="inline-flex min-h-[44px] items-center gap-1.5 text-foreground underline underline-offset-4 transition-all duration-200 hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Mail size={14} aria-hidden="true" />
          hello@sokar.tech
        </a>
      </p>
    </main>
  );
}
