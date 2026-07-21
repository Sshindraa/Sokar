import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse, type NextRequest } from 'next/server';

const isProtectedRoute = createRouteMatcher(['/dashboard(.*)', '/onboarding(.*)']);
const hasClerkKey = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

// Staging demo mode : si NEXT_PUBLIC_DEMO_RESTAURANT_ID + NEXT_PUBLIC_DEMO_STAGING
// sont définis, on ne force pas la connexion sur /dashboard. La prod n'a jamais
// ces variables → comportement inchangé.
const hasDemoRestaurant = Boolean(process.env.NEXT_PUBLIC_DEMO_RESTAURANT_ID);
const isStagingDemo = hasDemoRestaurant && Boolean(process.env.NEXT_PUBLIC_DEMO_STAGING);
const isLocalDemo = hasDemoRestaurant && process.env.NODE_ENV !== 'production';
const isDemoMode = isStagingDemo || isLocalDemo;

// En production, l'absence de clé Clerk est une erreur fatale : sans elle le
// middleware devient un no-op et /dashboard + /onboarding sont accessibles
// sans auth. En dev (preview locale sans Clerk) et en CI (E2E sans Clerk),
// on garde le bypass.
if (process.env.NODE_ENV === 'production' && !hasClerkKey && !process.env.CI) {
  throw new Error(
    'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY manquant en production — le middleware ' +
      'ne peut pas protéger les routes authentifiées. Vérifier apps/dashboard/.env.',
  );
}

/** URL de booking publique courte : /book/[slug] -> /widget/[slug] (meme widget). */
function rewriteBookToWidget(req: NextRequest): NextResponse | null {
  const match = req.nextUrl.pathname.match(/^\/book\/([^/]+)$/);
  if (!match) return null;
  const slug = match[1];
  const url = new URL(`/widget/${slug}`, req.url);
  url.search = req.nextUrl.search;
  return NextResponse.rewrite(url);
}

const middleware = hasClerkKey
  ? clerkMiddleware(async (auth, req) => {
      const rewrite = rewriteBookToWidget(req);
      if (rewrite) return rewrite;

      if (isProtectedRoute(req) && !isDemoMode) {
        const { userId } = await auth();
        if (!userId) {
          const signInUrl = new URL('/login', req.url);
          return NextResponse.redirect(signInUrl);
        }
      }
    })
  : function localPreviewMiddleware(req: NextRequest) {
      const rewrite = rewriteBookToWidget(req);
      if (rewrite) return rewrite;
      return NextResponse.next();
    };

export default middleware;

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
