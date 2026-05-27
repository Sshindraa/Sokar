import type { Metadata } from 'next';
import Link from 'next/link';
import { ClerkProvider, SignedIn, SignedOut, SignInButton, UserButton } from '@clerk/nextjs';
import { Button } from '@/components/ui/button';
import './globals.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Sokar — Restaurant Management',
  description: 'Assistant vocal intelligent pour votre restaurant',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider>
      <html lang="fr">
        <body className="min-h-screen bg-background antialiased">
          <header className="fixed left-1/2 top-5 z-50 w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 rounded-full border border-border bg-card/85 px-3 py-2 shadow-2xl shadow-background/40 backdrop-blur-xl">
            <div className="flex items-center justify-between gap-3">
              <Link
                href="/"
                className="flex min-w-0 items-center gap-2 rounded-full px-2 transition-all duration-200 hover:opacity-80"
              >
                <img src="/logo-nav.png" alt="Sokar" className="h-7 w-7 rounded-full" />
                <span className="text-sm font-semibold text-foreground">Sokar</span>
              </Link>
              <div className="flex items-center gap-1 sm:gap-2">
                <Link href="/pricing" className="sokar-pill border-transparent bg-transparent px-3 py-1.5">
                  Tarifs
                </Link>
                <SignedOut>
                  <SignInButton mode="redirect">
                    <Button size="sm" className="rounded-full transition-all duration-200">
                      Connexion
                    </Button>
                  </SignInButton>
                </SignedOut>
                <SignedIn>
                  <div className="flex items-center gap-2">
                    <Link
                      href="/dashboard"
                      className="hidden rounded-full px-3 py-1.5 text-sm font-medium text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground sm:inline-flex"
                    >
                      Dashboard
                    </Link>
                    <UserButton
                      appearance={{
                        elements: {
                          avatarBox: 'h-8 w-8',
                        },
                      }}
                    />
                  </div>
                </SignedIn>
              </div>
            </div>
          </header>
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
