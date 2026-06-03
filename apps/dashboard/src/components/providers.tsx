'use client';

import { ClerkProvider } from '@clerk/nextjs';
import { ReactNode } from 'react';

export default function Providers({ children }: { children: ReactNode }) {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  
  // Si Clerk n'est pas configuré, render les enfants sans ClerkProvider
  // Cela permet au site de fonctionner en mode dégradé pour les pages publiques
  if (!publishableKey) {
    return <>{children}</>;
  }
  
  return <ClerkProvider publishableKey={publishableKey}>{children}</ClerkProvider>;
}
