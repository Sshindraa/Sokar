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
          <header className="flex h-14 items-center justify-between border-b border-border px-6">
        <Link href="/" className="flex items-center gap-2">
          <img src="/logo-nav.png" alt="Sokar" className="h-7 w-7" />
          <span className="text-lg font-bold text-primary">Sokar</span>
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/pricing" className="text-sm text-muted-foreground transition-colors duration-200 hover:text-foreground">
            Tarifs
          </Link>
          <SignedOut>
            <SignInButton mode="redirect">
              <Button size="sm">Connexion</Button>
            </SignInButton>
          </SignedOut>
          <SignedIn>
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="text-sm font-medium text-muted-foreground transition-colors duration-200 hover:text-foreground"
            >
              Tableau de bord
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
      </header>
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
