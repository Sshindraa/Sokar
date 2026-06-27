import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const isProtectedRoute = createRouteMatcher(['/dashboard(.*)', '/onboarding(.*)']);
const hasClerkKey = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

// En production, l'absence de clé Clerk est une erreur fatale : sans elle le
// middleware devient un no-op et /dashboard + /onboarding sont accessibles
// sans auth. En dev (preview locale sans Clerk), on garde le bypass.
if (process.env.NODE_ENV === 'production' && !hasClerkKey) {
  throw new Error(
    'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY manquant en production — le middleware ' +
      'ne peut pas protéger les routes authentifiées. Vérifier apps/dashboard/.env.',
  );
}

const middleware = hasClerkKey
  ? clerkMiddleware(async (auth, req) => {
      if (isProtectedRoute(req)) {
        const { userId } = await auth();
        if (!userId) {
          const signInUrl = new URL('/login', req.url);
          return NextResponse.redirect(signInUrl);
        }
      }
    })
  : function localPreviewMiddleware() {
      return NextResponse.next();
    };

export default middleware;

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
