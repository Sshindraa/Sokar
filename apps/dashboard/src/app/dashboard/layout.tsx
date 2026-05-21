import Link from 'next/link';
import { ReactNode } from 'react';
import { SyncOrganization } from './SyncOrganization';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="w-64 border-r border-[var(--border)] bg-[var(--muted)] p-6">
        <Link href="/dashboard" className="text-xl font-bold text-[var(--primary)]">
          Sokar
        </Link>
        <nav className="mt-8 space-y-2">
          <NavItem href="/dashboard" label="Vue d'ensemble" />
          <NavItem href="/dashboard/calls" label="Appels" />
          <NavItem href="/dashboard/reservations" label="Réservations" />
          <NavItem href="/dashboard/settings" label="Paramètres" />
        </nav>
        <div className="mt-auto pt-8">
          <Link
            href="/login"
            className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          >
            Déconnexion
          </Link>
        </div>
      </aside>
      <main className="flex-1 p-8">
        <SyncOrganization />
        {children}
      </main>
    </div>
  );
}

function NavItem({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="block rounded-lg px-3 py-2 text-sm font-medium text-[var(--muted-foreground)] hover:bg-[var(--card)] hover:text-[var(--foreground)]"
    >
      {label}
    </Link>
  );
}
