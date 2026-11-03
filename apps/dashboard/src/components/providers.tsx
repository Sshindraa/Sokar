'use client';

import { ClerkProvider } from '@clerk/nextjs';
import { usePathname } from 'next/navigation';
import { clerkFrFR } from '@/lib/clerk-fr';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useEffect, useLayoutEffect, type ReactNode } from 'react';

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export default function Providers({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const isDemoMode = Boolean(
    process.env.NEXT_PUBLIC_DEMO_RESTAURANT_ID && process.env.NEXT_PUBLIC_DEMO_STAGING,
  );

  useIsomorphicLayoutEffect(() => {
    if (pathname === '/') {
      document.documentElement.classList.remove('dark', 'light');
    }
  }, [pathname]);

  const needsClerk =
    pathname?.startsWith('/login') ||
    pathname?.startsWith('/register') ||
    pathname?.startsWith('/dashboard') ||
    pathname?.startsWith('/admin') ||
    pathname?.startsWith('/onboarding');

  // /register et /onboarding appellent useAuth() : il leur faut Clerk, même en mode démo.
  const needsOperatorSession =
    pathname?.startsWith('/admin') ||
    pathname?.startsWith('/login') ||
    pathname?.startsWith('/register') ||
    pathname?.startsWith('/onboarding');

  // Public marketing pages must not depend on Clerk. Auth is mounted only
  // where the route actually needs login/session state.
  // Toaster et TooltipProvider sont partagés par toutes les pages, y compris les pages publiques.
  const app = (
    <TooltipProvider delayDuration={200}>
      {children}
      <Toaster />
    </TooltipProvider>
  );

  if (!needsClerk || !publishableKey || (isDemoMode && !needsOperatorSession)) {
    return <>{app}</>;
  }

  return (
    <ClerkProvider publishableKey={publishableKey} localization={clerkFrFR}>
      {app}
    </ClerkProvider>
  );
}
