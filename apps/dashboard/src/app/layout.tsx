import type { Metadata } from 'next';
import { ClerkProvider, SignedIn, SignedOut, SignInButton, UserButton } from '@clerk/nextjs';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sokar — Dashboard Restaurateur',
  description: 'Assistant vocal intelligent pour votre restaurant',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider>
      <html lang="fr">
        <body className="min-h-screen bg-[var(--background)] antialiased">
          <header className="flex h-14 items-center justify-end border-b border-[var(--border)] px-6">
            <SignedOut>
              <SignInButton mode="redirect">
                <button className="rounded-full bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white">
                  Connexion
                </button>
              </SignInButton>
            </SignedOut>
            <SignedIn>
              <UserButton
                appearance={{
                  elements: {
                    avatarBox: 'h-8 w-8',
                  },
                }}
              />
            </SignedIn>
          </header>
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
