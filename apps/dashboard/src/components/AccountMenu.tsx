'use client';

import { useTranslations } from 'next-intl';
import { useClerk, useUser } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { LogOut, Settings as SettingsIcon, User } from 'lucide-react';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

const hasClerkKey = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

/**
 * AccountMenu — avatar du profil + menu déroulant (Réglages, Déconnexion).
 *
 * Nécessite Clerk : sans clé `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (dev preview
 * locale), le composant ne rend rien. Le menu utilise `useClerk().signOut` pour
 * la déconnexion puis redirige vers `/login`.
 *
 * Styling cohérent avec `LanguageSwitcher` et `ThemeToggle` (pill rounded-full,
 * border-border, bg-card/80, hover bg-accent).
 */
export function AccountMenu() {
  // Sans clé Clerk, on ne rend rien (dev preview / CI sans auth).
  // On ne peut pas appeler useUser()/useClerk() sans ClerkProvider
  // monté — donc on court-circuite avant tout hook Clerk.
  if (!hasClerkKey) return null;
  return <AccountMenuInner />;
}

function AccountMenuInner() {
  const t = useTranslations('account');
  const { isSignedIn, user } = useUser();
  const { signOut } = useClerk();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close on Escape
  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, []);

  if (!isSignedIn || !user) return null;

  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  const email = user.primaryEmailAddress?.emailAddress;
  const displayName = fullName || email || t('label');

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut({ redirectUrl: '/login' });
    } catch {
      // signOut redirige ; en cas d'erreur on revient à l'état initial
      setSigningOut(false);
    }
  }

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('label')}
        title={t('label')}
        className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-card/80 text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground"
      >
        {user.imageUrl ? (
          <Image
            src={user.imageUrl}
            alt={displayName}
            width={36}
            height={36}
            className="h-full w-full object-cover"
            unoptimized
          />
        ) : (
          <User size={16} aria-hidden />
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 min-w-[200px] overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-md"
        >
          <div className="flex flex-col gap-0.5 px-3 py-2.5">
            <span className="truncate text-sm font-medium text-foreground">{displayName}</span>
            {email && email !== displayName && (
              <span className="truncate text-xs text-muted-foreground">{email}</span>
            )}
          </div>
          <div className="my-1 h-px bg-border" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              router.push('/dashboard/settings');
            }}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors duration-150 hover:bg-accent/50 hover:text-foreground"
          >
            <SettingsIcon size={14} aria-hidden />
            {t('settings')}
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={signingOut}
            onClick={handleSignOut}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors duration-150',
              'text-destructive hover:bg-destructive/10 hover:text-destructive',
              signingOut && 'opacity-60',
            )}
          >
            <LogOut size={14} aria-hidden />
            {signingOut ? t('signingOut') : t('signOut')}
          </button>
        </div>
      )}
    </div>
  );
}
