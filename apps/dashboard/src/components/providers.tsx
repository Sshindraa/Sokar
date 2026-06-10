'use client';

import { ClerkProvider } from '@clerk/nextjs';
import { usePathname } from 'next/navigation';
import { ReactNode } from 'react';

export default function Providers({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  const needsClerk =
    pathname?.startsWith('/login') ||
    pathname?.startsWith('/register') ||
    pathname?.startsWith('/dashboard');

  // Public marketing pages must not depend on Clerk. Auth is mounted only
  // where the route actually needs login/session state.
  if (!needsClerk || !publishableKey) {
    return <>{children}</>;
  }

  return <ClerkProvider publishableKey={publishableKey}>{children}</ClerkProvider>;
}
